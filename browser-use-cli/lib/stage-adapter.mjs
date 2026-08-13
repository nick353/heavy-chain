import fs from "node:fs";
import crypto from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

// Codex NodeREPL imports trusted modules without exposing the native process
// object. Keep the adapter import-safe while preserving the real process when
// it is available in the canonical helper/runtime.
const process = globalThis.process || {
  env: globalThis.nodeRepl?.env || {},
  pid: 0,
  getuid: undefined,
};
const HOST_HOME = os.homedir();
// Codex App's NodeREPL does not expose the host process environment to
// imported modules. The Browser Use helper is a Python entrypoint whose
// shebang resolves through env, so an empty inherited PATH makes the official
// bridge fail before it can emit a JSON receipt. Keep a minimal canonical
// executable path for that host while preserving an explicitly supplied PATH.
const DEFAULT_CHILD_PATH = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].join(path.delimiter);

/**
 * Shared Browser Use CLI stage boundary for registered automations.
 *
 * This module deliberately owns only the transport and proof boundary.  It
 * does not decide whether a business action is safe, does not manufacture an
 * authority file, and does not turn a click into a completed external effect.
 * The caller must provide a current-run authority file for authorized work
 * and must perform the business readback before recording an external action
 * as completed.
 */

const DEFAULT_STATE_ROOT = path.resolve(String(process.env.BROWSER_USE_STATE_ROOT || path.join(process.env.HOME || HOST_HOME, ".browser-use-cli")));
export const BROWSER_USE_HOME = path.resolve(String(process.env.BROWSER_USE_HOME || DEFAULT_STATE_ROOT));
const PACKAGE_HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "codex-browser-use");
const INSTALLED_HELPER = path.join(process.env.HOME || HOST_HOME, ".local", "bin", "codex-browser-use");
// The installed entrypoint is the live lane after installation. The package
// helper remains the deterministic fallback for a clean checkout before
// installation. Live adapters import this package, never a global skill copy.
export const BROWSER_USE_CLI_HELPER = path.resolve(String(
  process.env.BROWSER_USE_CLI_HELPER
    || (fs.existsSync(INSTALLED_HELPER) ? INSTALLED_HELPER : PACKAGE_HELPER),
));
export const BROWSER_USE_RUNTIME_CONFIG = path.resolve(String(process.env.BROWSER_USE_RUNTIME_CONFIG || path.join(BROWSER_USE_HOME, "browser-use-runtime.toml")));

export function browserUseCliChildEnvironment(baseEnv = process.env) {
  return Object.freeze({
    ...(baseEnv || {}),
    HOME: String(baseEnv?.HOME || HOST_HOME),
    PATH: String(baseEnv?.PATH || DEFAULT_CHILD_PATH),
    BROWSER_USE_HOME,
    BROWSER_USE_RUNTIME_CONFIG,
    BROWSER_USE_CLI_HELPER,
  });
}

export function createBrowserUseCliActionNonce({ runId = "", actionSequence = 0, salt = "" } = {}) {
  const sequence = Number.isSafeInteger(Number(actionSequence)) && Number(actionSequence) >= 0
    ? String(Number(actionSequence))
    : "0";
  const digest = crypto.createHash("sha256")
    .update(`${String(runId)}:${sequence}:${String(salt)}:${crypto.randomUUID()}`)
    .digest("hex")
    .slice(0, 32);
  return `bu-${digest}-${sequence}`;
}

export const BROWSER_USE_CLI_SURFACE = "browser_use_cli";
export const BROWSER_USE_CLI_ADAPTER_SCHEMA = "browser_use_cli_stage_observation.v1";
export const BROWSER_USE_CLI_START_DESCRIPTOR_SCHEMA = "browser_use_cli_start_descriptor.v1";
export const BROWSER_USE_CLI_SEMANTIC_READBACK_SCHEMA = "browser_use_semantic_readback.v1";
export const BROWSER_USE_CLI_FLOW_LEASE_SCHEMA = "browser-use-flow-lease.v2";
export const BROWSER_USE_CLI_ADAPTER_VERSION = "p6-authorized-scheduled.v1";
export const BROWSER_USE_CLI_CONTRACT_SCHEMA = "browser_use_cli_authorized_scheduled_flow.v1";
export const BROWSER_USE_CLI_FLOW_DESCRIPTOR_SCHEMA = "browser_use_cli_flow_descriptor.v2";
export const BROWSER_USE_CLI_AUTHORIZED_SCHEDULED_FLOW = true;
export const BROWSER_USE_CLI_START_IS_NON_NAVIGATING = true;
export const BROWSER_USE_CLI_RUNTIME_GATED_NON_GOAL = "real BROWSER_USE_HOME/runtime lifecycle is not exercised by this contract packet";
export const BROWSER_USE_CLI_P5_PUBLIC_LIFECYCLE_QUARANTINED = true;
export const BROWSER_USE_CLI_FINALIZE_ACCEPTANCE = Object.freeze({
  ffprobe: ["codec", "duration_seconds", "positive_frame_count"],
  hashes: ["mp4_sha256", "manifest_sha256"],
  external_effects: ["none", "executed"],
  close: "graceful_session_close",
  cleanup: ["sessions_closed", "pid_verified", "loopback_listener_closed", "profile_cleanup", "lock_cleanup"],
  unknown_process_policy: "never_kill_unknown; exact blocker",
  business_effect_proof: "navigation_readback_is_not_business_completion",
});
export const CODEX_APP_RUN_NOW_CAPABILITY_SCHEMA = "codex_app_run_now_capability.v1";
export const CODEX_APP_RUN_NOW_BLOCKER = "codex_app_automation_run_now_api_unavailable";
export const CODEX_APP_REGISTERED_ROOT_RECEIPT_SCHEMA = "codex_app_registered_root_receipt.v1";
export const CODEX_APP_REGISTERED_ROOT_RECEIPT_AUDIENCE = "codex_app_registered_automation";
const CODEX_APP_REGISTERED_ROOT_RECEIPT_MAX_TTL_MS = 60 * 60 * 1000;
const CODEX_APP_REGISTERED_ROOT_RECEIPT_FIELDS = [
  "schema", "issuer", "audience", "automation_id", "registered_prompt_sha256", "prompt_version",
  "invocation_id", "thread_id", "turn_id", "session_id", "run_id", "issued_at", "expires_at", "nonce",
];
const CODEX_APP_RUN_NOW_HANDLER_NAMES = new Set([
  "codex_app__automation_run_now",
  "codex_app__automation_run_now_handler",
  "codex_app__run_automation_now",
]);

/**
 * Inspect only a current-turn handler snapshot.  The management card handler
 * is intentionally reported as view-only and can never authorize a receipt.
 */
export function diagnoseCodexAppRunNowCapability({ handlerSnapshot = {} } = {}) {
  const names = Array.isArray(handlerSnapshot)
    ? new Set(handlerSnapshot.map((value) => String(value)))
    : new Set(handlerSnapshot && typeof handlerSnapshot === "object" ? Object.keys(handlerSnapshot).filter((name) => handlerSnapshot[name] !== false && handlerSnapshot[name] !== null) : []);
  const runNowHandlers = [...names].filter((name) => CODEX_APP_RUN_NOW_HANDLER_NAMES.has(name)).sort();
  const viewHandlerExposed = names.has("codex_app__automation_update");
  const available = runNowHandlers.length > 0;
  return Object.freeze({
    schema: CODEX_APP_RUN_NOW_CAPABILITY_SCHEMA,
    status: available ? "available" : "blocked",
    run_now_handler_exposed: available,
    run_now_handlers: Object.freeze(runNowHandlers),
    view_handler_exposed: viewHandlerExposed,
    view_handler_is_not_run_now: viewHandlerExposed,
    receipt_issuance_allowed: available,
    exact_blocker: available ? null : CODEX_APP_RUN_NOW_BLOCKER,
  });
}

export function requireCodexAppRunNowCapability(options = {}) {
  const diagnostic = diagnoseCodexAppRunNowCapability(options);
  if (diagnostic.status !== "available") throw exactError(CODEX_APP_RUN_NOW_BLOCKER, { capability: diagnostic });
  return diagnostic;
}

/**
 * Validate the official App handler's returned receipt without creating one.
 * The nonce set is caller-owned and must be persisted by the real execution
 * bridge when it needs replay protection across process restarts.
 */
export function validateCodexAppRunNowResult({ handlerSnapshot = {}, officialResult = null, expectedBinding = {}, consumedNonces } = {}) {
  const capability = requireCodexAppRunNowCapability({ handlerSnapshot });
  if (!(consumedNonces instanceof Set)) throw exactError("codex_app_registered_root_receipt_replay_guard_required");
  if (!officialResult || typeof officialResult !== "object" || Array.isArray(officialResult)) throw exactError("codex_app_registered_root_receipt_invalid");
  const handlerName = String(officialResult.handler_name || "").trim();
  if (!capability.run_now_handlers.includes(handlerName)) throw exactError("codex_app_registered_root_receipt_invalid");
  const resultFields = ["invocation_id", "thread_id", "turn_id", "session_id", "run_id"];
  for (const field of resultFields) if (!String(officialResult[field] || "").trim()) throw exactError("codex_app_registered_root_receipt_invalid");
  const receipt = officialResult.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw exactError("codex_app_registered_root_receipt_invalid");
  for (const field of CODEX_APP_REGISTERED_ROOT_RECEIPT_FIELDS) if (!(field in receipt)) throw exactError("codex_app_registered_root_receipt_invalid");
  if (receipt.schema !== CODEX_APP_REGISTERED_ROOT_RECEIPT_SCHEMA || receipt.issuer !== handlerName || receipt.audience !== CODEX_APP_REGISTERED_ROOT_RECEIPT_AUDIENCE) throw exactError("codex_app_registered_root_receipt_invalid");
  for (const field of ["automation_id", "prompt_version", ...resultFields]) if (typeof receipt[field] !== "string" || !receipt[field].trim()) throw exactError("codex_app_registered_root_receipt_invalid");
  if (!/^[a-f0-9]{64}$/u.test(String(receipt.registered_prompt_sha256 || "")) || !/^[a-f0-9]{32,128}$/u.test(String(receipt.nonce || ""))) throw exactError("codex_app_registered_root_receipt_invalid");
  const issuedAt = Date.parse(String(receipt.issued_at || ""));
  const expiresAt = Date.parse(String(receipt.expires_at || ""));
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > CODEX_APP_REGISTERED_ROOT_RECEIPT_MAX_TTL_MS || Date.now() < issuedAt || Date.now() >= expiresAt) throw exactError("codex_app_registered_root_receipt_invalid");
  for (const field of resultFields) if (receipt[field] !== officialResult[field]) throw exactError("codex_app_registered_root_receipt_invalid");
  for (const [field, expected] of Object.entries(expectedBinding || {})) if (!(field in receipt) || receipt[field] !== expected) throw exactError("codex_app_registered_root_receipt_invalid");
  if (consumedNonces.has(receipt.nonce)) throw exactError("codex_app_registered_root_receipt_replay");
  consumedNonces.add(receipt.nonce);
  return Object.freeze(Object.fromEntries(CODEX_APP_REGISTERED_ROOT_RECEIPT_FIELDS.map((field) => [field, receipt[field]])));
}

/** Keep helper/session proof separate from OS/process proof. */
export function buildBrowserUseCliCleanupProof(receipt = {}, { descriptorPath = "", receiptPath = "" } = {}) {
  const cleanup = receipt?.cleanup && typeof receipt.cleanup === "object" ? receipt.cleanup : {};
  const unknownProcesses = Array.isArray(cleanup.unknown_processes) ? [...cleanup.unknown_processes] : [];
  const helperSession = {
    session_close: cleanup.sessions_closed === true,
    descriptor_finalized: receipt.finalized === true,
    receipt_persisted: Boolean(receiptPath || receipt.receipt_path),
    daemon_closed: cleanup.daemon_closed === true,
    socket_absent: cleanup.socket_absent === true,
    profile_lock_released: cleanup.profile_lock_released === true,
  };
  const os = {
    expected_pid_start_identity: cleanup.pid_verified === true,
    loopback_listener_absent: cleanup.loopback_listener_closed === true,
    port_ownership_released: cleanup.port_ownership_released === true,
    lock_state: cleanup.lock_cleanup === true ? "released" : "unknown",
    unknown_processes: unknownProcesses,
    unknown_processes_untouched: cleanup.unknown_processes_untouched !== false,
  };
  const helperSessionVerified = Object.values(helperSession).every(Boolean);
  const osVerified = os.expected_pid_start_identity
    && os.loopback_listener_absent
    && os.port_ownership_released
    && os.lock_state === "released"
    && os.unknown_processes_untouched
    && os.unknown_processes.length === 0;
  return Object.freeze({
    schema: "browser_use_cli_cleanup_proof.v1",
    status: helperSessionVerified && osVerified ? "verified" : "incomplete",
    helper_session: Object.freeze(helperSession),
    os: Object.freeze(os),
    descriptor_path: descriptorPath ? path.resolve(String(descriptorPath)) : "",
    receipt_path: receiptPath ? path.resolve(String(receiptPath)) : "",
  });
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
// The helper emits a single JSON line containing a transient form snapshot
// capped at 128KB. Keep the parent transport above that envelope size so the
// final JSON remains parseable; durable artifacts still receive only the
// bounded/redacted metadata returned below.
// Keep the helper's bounded captured-readback JSON envelope parseable. The
// raw page snapshot remains transient and is redacted/bounded before return.
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const HELPER_TIMEOUT_GRACE_MS = 2_000;
const RECOVERY_TIMEOUT_MS = 20_000;
const P5_PUBLIC_ORIGIN = "https://example.com";
const P5_PUBLIC_PORT = 19980;
const BROWSER_USE_RECORDINGS_ROOT = path.join(BROWSER_USE_HOME, "recordings");
const BROWSER_USE_SCHEDULED_PROFILES_ROOT = path.join(BROWSER_USE_HOME, "profiles", "scheduled");
const BROWSER_USE_SINGLE_USE_PROFILES_ROOT = path.join(BROWSER_USE_HOME, "profiles", "single-use");
const BROWSER_USE_DOWNLOADS_ROOT = path.join(BROWSER_USE_HOME, "downloads");
const BROWSER_USE_LOCKS_ROOT = path.join(BROWSER_USE_HOME, "locks");
const BROWSER_USE_TAB_INVENTORY_SCHEMA = "browser-use-recording-tabs.v1";
const BROWSER_USE_DEFAULT_MAX_AUXILIARY_TABS = 16;
function p6RecordingsRoot() {
  if (process.env.CODEX_BROWSER_USE_TEST_SEAM !== "1") return BROWSER_USE_RECORDINGS_ROOT;
  const override = String(process.env.CODEX_BROWSER_USE_TEST_RECORDINGS_ROOT || "");
  return override && path.isAbsolute(override) ? path.resolve(override) : BROWSER_USE_RECORDINGS_ROOT;
}
const P5_INITIAL_COMMAND = ["state"];
const P5_NETWORK_COMMAND = ["open", P5_PUBLIC_ORIGIN];
const P5_READBACK_COMMANDS = [["state"], ["get", "title"], ["get", "url"]];
const AUTHORIZED_COMMANDS = new Set([
  "open", "click", "type", "input", "scroll", "back", "screenshot", "state",
  "switch", "close-tab", "keys", "select", "upload", "download", "eval",
  "extract", "hover", "dblclick", "rightclick", "wait", "get", "close",
]);
const PUBLIC_COMMANDS = new Set(["open", "get", "state", "screenshot", "scroll", "wait", "extract", "back", "close-tab"]);
const READ_ONLY_LINK_EVAL = "Array.from(document.querySelectorAll('a[href*=\"/jobs/view/\"]')).map((a) => a.href)";
const READ_ONLY_SOCIAL_LINK_EVAL = "Array.from(document.querySelectorAll('a[href]')).map((a) => a.href).filter((href) => /(?:x\\.com\\/[^/]+\\/status\\/\\d+|linkedin\\.com\\/feed\\/update\\/urn:li:(?:activity|share):\\d+)/i.test(href)).slice(0, 4)";
const READ_ONLY_SOCIAL_CARD_EVAL = "Array.from(document.querySelectorAll('[data-urn],[data-id],[data-activity-urn],a[href]')).map((e) => ({href: e.href || '', urn: e.getAttribute('data-urn') || e.getAttribute('data-id') || e.getAttribute('data-activity-urn') || '', text: (e.innerText || e.textContent || '').trim().slice(0, 160)})).filter((v) => /18 years|core dump|activity|feed\\/update|urn:li/i.test(`${v.href} ${v.urn} ${v.text}`)).slice(0, 8)";
const READ_ONLY_SOCIAL_FEED_CARD_EVAL = "Array.from(document.querySelectorAll('article,[role=\"article\"],[data-urn],[data-id],[data-activity-urn]')).map((e) => ({href: e.querySelector('a[href]')?.href || '', urn: e.getAttribute('data-urn') || e.getAttribute('data-id') || e.getAttribute('data-activity-urn') || '', text: (e.innerText || '').trim().slice(0, 160)})).filter((v) => v.href || v.urn).slice(0, 12)";
const READ_ONLY_SOCIAL_CARD_CONTAINER_EVAL = "Array.from(document.querySelectorAll('article,[role=\"article\"],div')).map((e) => ({href: e.querySelector('a[href]')?.href || '', urn: e.getAttribute('data-urn') || e.getAttribute('data-id') || e.getAttribute('data-activity-urn') || '', text: (e.innerText || '').trim().slice(0, 160)})).filter((v) => /18 years|core dump/i.test(v.text)).slice(0, 8)";
// Bounded link metadata is enough to discover a company/ATS application
// route.  Do not expand this to page HTML, body text, cookies, or form
// values: those remain outside the transport readback contract.
const READ_ONLY_APPLICATION_LINK_EVAL = "Array.from(document.querySelectorAll('a[href]')).map((a) => ({href: a.href, text: (a.innerText || a.textContent || '').trim().slice(0, 160)})).filter((a) => a.href)";
const READ_ONLY_JOB_DETAIL_EVAL = `(() => { const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 240); const root = document; const roleSelectors = ['[class*="job-details-jobs-unified-top-card__job-title"]', '[class*="jobs-unified-top-card__job-title"]', '[data-test-job-details-jobs-unified-top-card-job-title]', 'h1', 'h2', 'h3', '[role="heading"]']; const ignoredHeading = /^(?:\\d+\\s+notifications?|notifications?|home|my network|messaging|sign in|log in|join now)$/iu; const roleNode = roleSelectors.flatMap((selector) => Array.from(root.querySelectorAll(selector))).find((node) => { const text = clean(node.innerText || node.textContent); if (!text || ignoredHeading.test(text)) return false; const className = String(node.className || ''); return /job-title|top-card__job-title/iu.test(className) || /\\b(?:manager|director|specialist|lead|coordinator|analyst|marketing|engineer|designer|producer|consultant|developer|product)\\b/iu.test(text); }); const role = clean(roleNode?.innerText || roleNode?.textContent); const ancestors = []; let cursor = roleNode; for (let i = 0; cursor && i < 8; i += 1, cursor = cursor.parentElement) { const lines = String(cursor.innerText || cursor.textContent || '').split(/\\n+/).map(clean).filter(Boolean).slice(0, 12); ancestors.push({ node: cursor, lines }); } const matchingAncestors = ancestors.filter(({ lines }) => lines.some((line) => line === role || line.includes(role))); const selected = matchingAncestors.find(({ lines }) => lines.length >= 3) || matchingAncestors.find(({ lines }) => lines.length >= 2) || matchingAncestors[0] || ancestors[0] || { node: root, lines: [] }; const scopes = []; for (const entry of [selected, ...ancestors]) { if (entry.node && !scopes.includes(entry.node)) scopes.push(entry.node); } scopes.push(root); const companySelectors = ['a[href*="/company/"]', '[class~="job-details-jobs-unified-top-card__company-name"]', '[class*="job-details-jobs-unified-top-card__company-name"]', '[class*="jobs-unified-top-card__company-name"]', '[data-test-job-details-jobs-unified-top-card-company-name]', '[data-tracking-control-name*="org-name"]']; const explicitCompany = scopes.flatMap((scope) => companySelectors.flatMap((selector) => Array.from(scope.querySelectorAll(selector)))).map((node) => clean(node.innerText || node.textContent)).find(Boolean) || ''; const ignored = /^(?:jobs|home|my network|messaging|notifications|apply|save|on-site|full-time|promoted by|backfilling a role)$/iu; const nearbyLines = selected.lines.filter((line) => line && line !== role && !ignored.test(line)); const ancestorCompany = nearbyLines[0] || ''; const bodyLines = String(root.body?.innerText || '').split(/\\n+/).map(clean).filter(Boolean).slice(0, 240); const bodyRoleIndex = bodyLines.findIndex((line) => line === role || line.includes(role)); const bodyNearby = bodyRoleIndex >= 0 ? bodyLines.slice(Math.max(0, bodyRoleIndex - 4), bodyRoleIndex + 5) : []; const bodyCompany = bodyNearby.find((line) => line && line !== role && !ignored.test(line) && !/^(?:\\d+\\s+applicants?|[A-Za-z -]+,\\s*(?:Japan|Tokyo)|reposted|promoted by|on-site|full-time)$/iu.test(line)) || ''; const imageCompany = scopes.flatMap((scope) => Array.from(scope.querySelectorAll('img[alt]'))).map((node) => clean(node.getAttribute('alt'))).filter((alt) => alt && /logo/iu.test(alt)).map((alt) => alt.replace(/\\s+logo$/iu, '')).find(Boolean) || ''; return JSON.stringify({ role, company: explicitCompany || ancestorCompany || bodyCompany || imageCompany }); })()`;
const P6_MAX_STRING_LENGTH = 512;
// A form can place its navigation controls after the first 512 characters of
// a read-only state snapshot. Keep this larger bound only for transient state
// readback; it is never persisted as an artifact by the workflow adapters.
const P6_MAX_TRANSIENT_READBACK_LENGTH = 512_000;
const P6_MAX_ARRAY_LENGTH = 32;
const P6_MAX_OBJECT_KEYS = 64;
const P6_MAX_ERROR_LENGTH = 160;
const P6_SECRET_KEY = /(?:token|secret|password|passwd|cookie|authorization|credential|api[_-]?key|private[_-]?key|access[_-]?key|refresh[_-]?token|body|html|stdout|stderr|cdp|url_with_userinfo)/iu;
const EXTERNAL_EFFECT_STATES = new Set(["none", "executed", "unknown"]);
const P6_ALLOWED_ACTIONS = Object.freeze([...AUTHORIZED_COMMANDS].sort());
let p6TestCommandInvoker = null;
export const BROWSER_USE_CLI_ALLOWED_ACTIONS = P6_ALLOWED_ACTIONS;
export const BROWSER_USE_CLI_READ_ONLY_APPLICATION_LINK_EVAL = READ_ONLY_APPLICATION_LINK_EVAL;
export const BROWSER_USE_CLI_READ_ONLY_JOB_DETAIL_EVAL = READ_ONLY_JOB_DETAIL_EVAL;
export const BROWSER_USE_CLI_READ_ONLY_SOCIAL_LINK_EVAL = READ_ONLY_SOCIAL_LINK_EVAL;
export const BROWSER_USE_CLI_READ_ONLY_SOCIAL_CARD_EVAL = READ_ONLY_SOCIAL_CARD_EVAL;
export const BROWSER_USE_CLI_READ_ONLY_SOCIAL_FEED_CARD_EVAL = READ_ONLY_SOCIAL_FEED_CARD_EVAL;
export const BROWSER_USE_CLI_READ_ONLY_SOCIAL_CARD_CONTAINER_EVAL = READ_ONLY_SOCIAL_CARD_CONTAINER_EVAL;
export const BROWSER_USE_CLI_BOUNDED_RESULT_LIMITS = Object.freeze({
  max_string_length: P6_MAX_STRING_LENGTH,
  max_array_length: P6_MAX_ARRAY_LENGTH,
  max_object_keys: P6_MAX_OBJECT_KEYS,
  max_error_length: P6_MAX_ERROR_LENGTH,
});
export const BROWSER_USE_CLI_SECRET_FREE_DECLARATION = Object.freeze({
  inputs: "paths, identifiers, normalized origins, action names, and digests only; credentials/page bodies are not accepted",
  outputs: "bounded structured metadata only; stdout/stderr, page bodies, cookies, tokens, and secret-shaped values are redacted",
});
export function browserUseCliTransportMarker({ viaTestSeam = false } = {}) {
  return viaTestSeam ? "test_seam" : "helper";
}
export const BROWSER_USE_CLI_CONTRACT_METADATA = Object.freeze({
  schema: BROWSER_USE_CLI_CONTRACT_SCHEMA,
  adapter_version: BROWSER_USE_CLI_ADAPTER_VERSION,
  authorized_scheduled_flow: true,
  start_is_non_navigating: true,
  descriptor_schema: BROWSER_USE_CLI_FLOW_DESCRIPTOR_SCHEMA,
  lease_schema: BROWSER_USE_CLI_FLOW_LEASE_SCHEMA,
  allowed_actions: P6_ALLOWED_ACTIONS,
  bounded_result_limits: BROWSER_USE_CLI_BOUNDED_RESULT_LIMITS,
  secret_free: BROWSER_USE_CLI_SECRET_FREE_DECLARATION,
});

function exactError(code, evidence = {}) {
  const error = new Error(code);
  error.exact_blocker = code;
  error.evidence = evidence;
  return error;
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function browserUseCliHelperSourceParity() {
  const helperPath = path.resolve(BROWSER_USE_CLI_HELPER);
  const packagePath = path.resolve(PACKAGE_HELPER);
  try {
    const helperStat = fs.statSync(helperPath);
    const packageStat = fs.statSync(packagePath);
    const helperDigest = sha256File(helperPath);
    const packageDigest = sha256File(packagePath);
    return Object.freeze({
      helper_path: helperPath,
      package_path: packagePath,
      helper_sha256: helperDigest,
      package_sha256: packageDigest,
      same_source: fs.realpathSync(helperPath) === fs.realpathSync(packagePath) || helperDigest === packageDigest,
      helper_owner_uid: helperStat.uid,
      package_owner_uid: packageStat.uid,
      helper_mode: helperStat.mode & 0o777,
      package_mode: packageStat.mode & 0o777,
    });
  } catch (_) {
    return Object.freeze({
      helper_path: helperPath,
      package_path: packagePath,
      helper_sha256: "",
      package_sha256: "",
      same_source: false,
      helper_owner_uid: null,
      package_owner_uid: null,
      helper_mode: null,
      package_mode: null,
    });
  }
}

function assertBrowserUseCliHelperSourceParity() {
  const parity = browserUseCliHelperSourceParity();
  const currentUid = typeof process.getuid === "function" ? process.getuid() : parity.helper_owner_uid;
  if (
    parity.same_source !== true
    || parity.helper_owner_uid !== currentUid
    || parity.helper_mode !== 0o700
  ) {
    throw p6RedactedError("browser_use_cli_helper_source_parity_required", {
      helper_sha256: parity.helper_sha256,
      package_sha256: parity.package_sha256,
      helper_mode: parity.helper_mode,
    });
  }
  return parity;
}

function currentAdapterSha256() {
  return sha256Text(fs.readFileSync(new URL(import.meta.url)));
}

function stableValue(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, P6_MAX_ARRAY_LENGTH).map((entry) => stableValue(entry, depth + 1));
  return Object.fromEntries(Object.keys(value).sort().slice(0, P6_MAX_OBJECT_KEYS).map((key) => [key, stableValue(value[key], depth + 1)]));
}

function digestValue(value) {
  return sha256Text(JSON.stringify(stableValue(value)));
}

function boundedString(value, max = P6_MAX_STRING_LENGTH) {
  const text = String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function sanitizeTransientReadbackText(value) {
  const text = String(value ?? "")
    .replace(/\b(value|data-value|defaultValue|aria-valuetext)\s*=\s*(["'])[^"']*\2/giu, "$1=\"<redacted>\"")
    .replace(/\b(value|data-value|defaultValue|aria-valuetext)\s*=\s*(?!["'])([^\s>]+)/giu, "$1=<redacted>");
  return boundedString(text, P6_MAX_TRANSIENT_READBACK_LENGTH);
}

function redactValue(value, key = "", depth = 0) {
  if (depth > 8) return "<depth-limited>";
  if (P6_SECRET_KEY.test(String(key))) return "<redacted>";
  if (typeof value === "string") {
    if (/^(?:bearer\s+|sk-[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]+\.)/iu.test(value) || /(?:password|token|secret|cookie)\s*[:=]/iu.test(value)) return "<redacted>";
    // Captured readbacks are emitted as numeric command-index keys ("0",
    // "1", ...). Treat those values as transient too, otherwise the generic
    // 512-character string cap silently cuts the form controls and CTA at
    // the end of a multi-page snapshot before the business adapter parses it.
    if (["_raw_text", "state", "text", "result"].includes(String(key)) || /^\d+$/u.test(String(key))) return sanitizeTransientReadbackText(value);
    return boundedString(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, P6_MAX_ARRAY_LENGTH).map((entry) => redactValue(entry, key, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).slice(0, P6_MAX_OBJECT_KEYS).map((entryKey) => [entryKey, redactValue(value[entryKey], entryKey, depth + 1)]));
  }
  return "<redacted>";
}

export function redactBrowserUseCliResult(value) {
  return Object.freeze(redactValue(value));
}

export function normalizeBrowserUseCliCapturedReadback(value) {
  let current = value;
  for (let depth = 0; depth < 6 && typeof current === "string"; depth += 1) {
    try {
      const parsed = JSON.parse(current);
      if (parsed === current) break;
      current = parsed;
    } catch {
      break;
    }
  }
  // Parse the transient JSON envelope before bounded redaction. Redacting the
  // raw stdout string first can cut a valid envelope at P6_MAX_STRING_LENGTH,
  // making bounded role/company readback impossible. The returned structure is
  // still redacted and is consumed in-memory; callers persist hashes/booleans.
  return typeof current === "string" ? sanitizeTransientReadbackText(current) : redactBrowserUseCliResult(current);
}

function normalizeExternalEffects(value, fallback = "unknown") {
  const candidate = String(value || fallback);
  if (!EXTERNAL_EFFECT_STATES.has(candidate)) throw p6RedactedError("browser_use_cli_external_effects_invalid");
  return candidate;
}

function p6RedactedError(code, evidence = {}) {
  const error = exactError(code);
  error.evidence = redactValue(evidence);
  error.safe_detail = boundedString(code, P6_MAX_ERROR_LENGTH);
  return error;
}

function normalizeP6Origin(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw p6RedactedError("browser_use_cli_origin_invalid"); }
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password) throw p6RedactedError("browser_use_cli_origin_invalid");
  return url.origin;
}

function parseP6Time(value, field) {
  const millis = Date.parse(String(value || ""));
  if (!Number.isFinite(millis)) throw p6RedactedError(`browser_use_cli_${field}_invalid`);
  return millis;
}

function requireP6String(value, field) {
  const text = String(value ?? "");
  if (!text) throw p6RedactedError(`browser_use_cli_${field}_missing`);
  safeIdentifier(text, field);
  return text;
}

function requireP6Value(value, field) {
  const text = boundedString(value);
  if (!text) throw p6RedactedError(`browser_use_cli_${field}_missing`);
  return text;
}

function normalizeP6Session(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw p6RedactedError(`browser_use_cli_${field}_missing`);
  safeIdentifier(text, field);
  return text;
}

function validateP6RuntimeHome(homeId, runId) {
  const resolved = path.resolve(String(homeId || ""));
  if (!path.isAbsolute(String(homeId || "")) || resolved !== String(homeId) || resolved !== BROWSER_USE_HOME) {
    throw p6RedactedError("browser_use_cli_runtime_home_invalid");
  }
  return `${resolved}/runs/${runId}`;
}

function validateP6AuthorityFile(authorityPath, { automationId, runId, stageId, contract } = {}) {
  const resolved = assertAbsoluteRegularFile(authorityPath, "browser_use_cli_authority_required");
  let authority;
  try { authority = JSON.parse(fs.readFileSync(resolved, "utf8")); } catch { throw p6RedactedError("browser_use_cli_authority_malformed"); }
  if (!authority || typeof authority !== "object" || Array.isArray(authority)) throw p6RedactedError("browser_use_cli_authority_malformed");
  if (!authority.automation_id || !authority.run_id || !authority.stage_id || authority.mode !== "authorized" || !authority.expires_at) throw p6RedactedError("browser_use_cli_authority_binding_missing");
  const match = (value, expected, code) => { if (value !== undefined && String(value) !== String(expected)) throw p6RedactedError(code); };
  match(authority.automation_id ?? authority.automationId, automationId, "browser_use_cli_authority_mismatch");
  match(authority.run_id ?? authority.runId, runId, "browser_use_cli_authority_mismatch");
  match(authority.stage_id ?? authority.stageId, stageId, "browser_use_cli_authority_mismatch");
  if (authority.mode !== undefined && authority.mode !== "authorized") throw p6RedactedError("browser_use_cli_authority_mode_invalid");
  if (authority.expires_at && parseP6Time(authority.expires_at, "authority_expires_at") <= Date.now()) throw p6RedactedError("browser_use_cli_authority_expired");
  if (authority.not_before && parseP6Time(authority.not_before, "authority_not_before") > Date.now()) throw p6RedactedError("browser_use_cli_authority_not_before");
  if (authority.sha256 && contract?.authority?.sha256 && String(authority.sha256) !== String(contract.authority.sha256)) throw p6RedactedError("browser_use_cli_authority_mismatch");
  if (contract?.authority?.sha256 && sha256File(resolved) !== String(contract.authority.sha256)) throw p6RedactedError("browser_use_cli_authority_digest_mismatch");
  return resolved;
}

function normalizeP6ContractOrigins(origins) {
  if (!Array.isArray(origins)) throw p6RedactedError("browser_use_cli_allowed_origins_invalid");
  return [...new Set(origins.map(normalizeP6Origin))].sort();
}

function normalizeP6Actions(actions) {
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > P6_MAX_ARRAY_LENGTH) throw p6RedactedError("browser_use_cli_allowed_actions_invalid");
  const normalized = [...new Set(actions.map((value) => String(value)))].sort();
  for (const action of normalized) if (!AUTHORIZED_COMMANDS.has(action)) throw p6RedactedError("browser_use_cli_allowed_action_invalid", { action });
  return normalized;
}

function normalizeP6Window({ notBefore, expiresAt, required = false } = {}) {
  if (required && (!notBefore || !expiresAt)) throw p6RedactedError("browser_use_cli_authority_window_missing");
  const now = Date.now();
  const before = notBefore ? parseP6Time(notBefore, "authority_not_before") : now - 1000;
  const after = expiresAt ? parseP6Time(expiresAt, "authority_expires_at") : now + 5 * 60 * 1000;
  if (after <= before) throw p6RedactedError("browser_use_cli_authority_window_invalid");
  return { not_before: new Date(before).toISOString(), expires_at: new Date(after).toISOString() };
}

function ensureP6LiveWindow(contract, now = Date.now()) {
  const before = parseP6Time(contract.not_before, "authority_not_before");
  const after = parseP6Time(contract.expires_at, "authority_expires_at");
  if (now < before) throw p6RedactedError("browser_use_cli_authority_not_before");
  if (now >= after) throw p6RedactedError("browser_use_cli_authority_expired");
}

export function createBrowserUseCliFlowContract({
  automationId,
  runId,
  stageId,
  session = "",
  mode = "authorized",
  lifecycle = "scheduled",
  authorityPath = "",
  allowedOrigins = [],
  descriptorPath = "",
  contract = {},
} = {}) {
  const source = contract && typeof contract === "object" ? contract : {};
  const automation = requireP6String(automationId, "automation_id");
  const run = requireP6String(runId, "run_id");
  const step = requireP6String(source.stepId ?? source.step_id ?? stageId, "step_id");
  const requestedSession = normalizeP6Session(source.requestedSession ?? source.requested_session ?? (session || `${automation}-${step}`), "requested_session");
  const effectiveSession = normalizeP6Session(source.effectiveSession ?? source.effective_session ?? requestedSession, "effective_session");
  if (!['authorized', 'public'].includes(mode)) throw p6RedactedError("browser_use_cli_mode_invalid");
  if (!['scheduled', 'single-use'].includes(lifecycle)) throw p6RedactedError("browser_use_cli_lifecycle_invalid");
  if (mode === "authorized" && lifecycle !== "scheduled") throw p6RedactedError("browser_use_cli_authorized_requires_scheduled");
  const workflowId = requireP6String(source.workflowId ?? source.workflow_id ?? automation, "workflow_id");
  const workflowVersion = requireP6String(source.workflowVersion ?? source.workflow_version ?? "1", "workflow_version");
  const attemptId = requireP6String(source.attemptId ?? source.attempt_id ?? `${step}-attempt-1`, "attempt_id");
  const flowId = requireP6String(source.flowId ?? source.flow_id ?? `${automation}-${run}-${step}-${attemptId}`, "flow_id");
  const leaseId = requireP6String(source.leaseId ?? source.lease_id ?? `${flowId}-lease`, "lease_id");
  const generation = Number(source.generation ?? source.epoch ?? 1);
  if (!Number.isSafeInteger(generation) || generation < 1) throw p6RedactedError("browser_use_cli_generation_invalid");
  const origins = normalizeP6ContractOrigins(allowedOrigins);
  const actions = normalizeP6Actions(source.allowedActions ?? source.allowed_actions ?? P6_ALLOWED_ACTIONS);
  const authoritySha = String(source.authoritySha256 ?? source.authority_sha256 ?? "");
  const authorityId = requireP6String(source.authorityId ?? source.authority_id ?? (mode === "public" ? "public-manifest" : authoritySha ? `authority-${authoritySha.slice(0, 24)}` : ""), "authority_id");
  const authoritySchema = requireP6String(source.authoritySchema ?? source.authority_schema ?? "authority.v1", "authority_schema");
  const authorityVersion = requireP6String(source.authorityVersion ?? source.authority_version ?? "1", "authority_version");
  if (mode === "authorized" && !/^[a-f0-9]{64}$/u.test(authoritySha)) throw p6RedactedError("browser_use_cli_authority_digest_invalid");
  const window = normalizeP6Window({
    notBefore: source.notBefore ?? source.not_before,
    expiresAt: source.expiresAt ?? source.expires_at,
    required: mode === "authorized",
  });
  const runtimeHomeId = String(source.runtimeHomeId ?? source.runtime_home_id ?? BROWSER_USE_HOME);
  const runtimeRunBinding = validateP6RuntimeHome(runtimeHomeId, run);
  const runtimeHomeDigest = String(source.runtimeHomeDigest ?? source.runtime_home_digest ?? digestValue(runtimeRunBinding));
  if (!/^[a-f0-9]{64}$/u.test(runtimeHomeDigest)) throw p6RedactedError("browser_use_cli_runtime_digest_invalid");
  const resolvedDescriptorPath = String(descriptorPath || source.descriptorPath || source.descriptor_path || path.join(p6RecordingsRoot(), run, `${step}.descriptor.json`));
  if (!path.isAbsolute(resolvedDescriptorPath)) throw p6RedactedError("browser_use_cli_descriptor_identity_invalid");
  const now = new Date().toISOString();
  const adapterSha256 = String(source.adapterSha256 ?? source.adapter_sha256 ?? currentAdapterSha256());
  if (!/^[a-f0-9]{64}$/u.test(adapterSha256)) throw p6RedactedError("browser_use_cli_adapter_digest_invalid");
  const authority = Object.freeze({
    id: authorityId,
    reference: mode === "authorized" ? String(authorityPath || source.authorityReference || source.authority_reference || "") : "public-manifest",
    schema: authoritySchema,
    version: authorityVersion,
    sha256: mode === "authorized" ? authoritySha : digestValue("public-manifest"),
    mode,
  });
  const contractValue = {
    schema: BROWSER_USE_CLI_CONTRACT_SCHEMA,
    adapter_version: BROWSER_USE_CLI_ADAPTER_VERSION,
    adapter_sha256: adapterSha256,
    authorized_scheduled_flow: mode === "authorized" && lifecycle === "scheduled",
    start_is_non_navigating: true,
    mode,
    lifecycle,
    descriptor_schema: BROWSER_USE_CLI_FLOW_DESCRIPTOR_SCHEMA,
    lease_schema: BROWSER_USE_CLI_FLOW_LEASE_SCHEMA,
    flow_id: flowId,
    lease_id: leaseId,
    generation,
    authority,
    workflow: Object.freeze({ id: workflowId, version: workflowVersion }),
    automation_id: automation,
    run_id: run,
    step_id: step,
    attempt_id: attemptId,
    requested_session: requestedSession,
    effective_session: effectiveSession,
    allowed_actions: Object.freeze(actions),
    allowed_actions_digest: digestValue(actions),
    normalized_origins: Object.freeze(origins),
    normalized_origin_digest: digestValue(origins),
    runtime: Object.freeze({ home_id: runtimeHomeId, home_digest: runtimeHomeDigest, run_id: run, run_binding: digestValue(runtimeRunBinding) }),
    descriptor: Object.freeze({ path: resolvedDescriptorPath, identity: digestValue(resolvedDescriptorPath) }),
    created_at: String(source.createdAt ?? source.created_at ?? now),
    not_before: window.not_before,
    expires_at: window.expires_at,
    descriptor_state: "starting",
    recorder_active: false,
    tab_management: String(source.tabManagement ?? source.tab_management ?? "default"),
    max_auxiliary_tabs: Number(source.maxAuxiliaryTabs ?? source.max_auxiliary_tabs ?? BROWSER_USE_DEFAULT_MAX_AUXILIARY_TABS),
    navigation_commands_before_validation: 0,
    action_sequence: Number(source.actionSequence ?? source.action_sequence ?? 0),
    last_action_nonce: String(source.lastActionNonce ?? source.last_action_nonce ?? ""),
    lease_state: "held",
  };
  if (!(contractValue.tab_management === "default" || contractValue.tab_management === "single_working_tab")) {
    throw p6RedactedError("browser_use_cli_tab_management_invalid");
  }
  if (!Number.isSafeInteger(contractValue.max_auxiliary_tabs) || contractValue.max_auxiliary_tabs < 0 || contractValue.max_auxiliary_tabs > BROWSER_USE_DEFAULT_MAX_AUXILIARY_TABS) {
    throw p6RedactedError("browser_use_cli_max_auxiliary_tabs_invalid");
  }
  if (!Number.isSafeInteger(contractValue.action_sequence) || contractValue.action_sequence < 0) throw p6RedactedError("browser_use_cli_action_sequence_invalid");
  return Object.freeze(contractValue);
}

function assertP6ContractShape(contract, { requireLive = true } = {}) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) throw p6RedactedError("browser_use_cli_contract_missing");
  if (contract.schema !== BROWSER_USE_CLI_CONTRACT_SCHEMA || contract.adapter_version !== BROWSER_USE_CLI_ADAPTER_VERSION || contract.descriptor_schema !== BROWSER_USE_CLI_FLOW_DESCRIPTOR_SCHEMA || contract.lease_schema !== BROWSER_USE_CLI_FLOW_LEASE_SCHEMA || contract.start_is_non_navigating !== true) throw p6RedactedError("browser_use_cli_contract_schema_mismatch");
  for (const field of ["flow_id", "lease_id", "automation_id", "run_id", "step_id", "attempt_id", "requested_session", "effective_session", "allowed_actions_digest", "normalized_origin_digest", "created_at", "not_before", "expires_at"]) requireP6String(contract[field], field);
  if (!Number.isSafeInteger(Number(contract.generation)) || Number(contract.generation) < 1) throw p6RedactedError("browser_use_cli_generation_invalid");
  if (!contract.authority || !contract.authority.id || !contract.authority.schema || !contract.authority.version || !contract.authority.sha256) throw p6RedactedError("browser_use_cli_authority_binding_incomplete");
  if (!contract.workflow?.id || !contract.workflow?.version) throw p6RedactedError("browser_use_cli_workflow_binding_incomplete");
  if (!contract.runtime?.home_id || String(contract.runtime.home_id) !== BROWSER_USE_HOME || contract.runtime.run_id !== contract.run_id || !/^[a-f0-9]{64}$/u.test(String(contract.runtime.home_digest || "")) || !/^[a-f0-9]{64}$/u.test(String(contract.runtime.run_binding || ""))) throw p6RedactedError("browser_use_cli_runtime_binding_incomplete");
  if (!contract.descriptor?.path || !/^[a-f0-9]{64}$/u.test(String(contract.descriptor.identity || ""))) throw p6RedactedError("browser_use_cli_descriptor_binding_incomplete");
  if (!Array.isArray(contract.allowed_actions) || contract.allowed_actions.length === 0 || contract.allowed_actions_digest !== digestValue(contract.allowed_actions)) throw p6RedactedError("browser_use_cli_action_binding_incomplete");
  if (!Array.isArray(contract.normalized_origins) || contract.normalized_origin_digest !== digestValue(contract.normalized_origins)) throw p6RedactedError("browser_use_cli_origin_binding_incomplete");
  const tabManagement = String(contract.tab_management || "default");
  const maxAuxiliaryTabs = Number(contract.max_auxiliary_tabs ?? BROWSER_USE_DEFAULT_MAX_AUXILIARY_TABS);
  if (!(tabManagement === "default" || tabManagement === "single_working_tab") || !Number.isSafeInteger(maxAuxiliaryTabs) || maxAuxiliaryTabs < 0 || maxAuxiliaryTabs > BROWSER_USE_DEFAULT_MAX_AUXILIARY_TABS) {
    throw p6RedactedError("browser_use_cli_tab_management_invalid");
  }
  if (requireLive) ensureP6LiveWindow(contract);
  return contract;
}

function validateP6Action(command, contract, { actionSequence, actionNonce } = {}) {
  if (!Array.isArray(command) || command.length === 0 || typeof command[0] !== "string") throw p6RedactedError("browser_use_cli_command_invalid");
  const action = command[0];
  if (!contract.allowed_actions.includes(action)) throw p6RedactedError("browser_use_cli_action_not_allowed", { action });
  const sequence = Number(actionSequence);
  if (!Number.isSafeInteger(sequence) || sequence <= Number(contract.action_sequence)) throw p6RedactedError("browser_use_cli_action_sequence_replay");
  const nonce = String(actionNonce || "");
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(nonce) || nonce === contract.last_action_nonce) throw p6RedactedError("browser_use_cli_action_nonce_replay");
  if (action === "open") {
    let url;
    try { url = new URL(String(command[1] || "")); } catch { throw p6RedactedError("browser_use_cli_target_url_invalid"); }
    if (url.username || url.password || !/^https?:$/u.test(url.protocol)) throw p6RedactedError("browser_use_cli_target_url_invalid");
    if (!contract.normalized_origins.includes(url.origin)) throw p6RedactedError("browser_use_cli_origin_mismatch", { origin: url.origin });
  }
  return { action, sequence, nonce };
}

const BROWSER_USE_CLI_READ_ONLY_BATCH_COMMANDS = new Set([
  "open", "back", "switch", "state", "get", "screenshot", "extract", "wait", "scroll", "close-tab",
]);
const BROWSER_USE_CLI_READ_ONLY_BATCH_EVALS = new Set([
  "location.href",
  "document.title",
  READ_ONLY_LINK_EVAL,
  READ_ONLY_APPLICATION_LINK_EVAL,
  READ_ONLY_JOB_DETAIL_EVAL,
  READ_ONLY_SOCIAL_LINK_EVAL,
  READ_ONLY_SOCIAL_CARD_EVAL,
  READ_ONLY_SOCIAL_FEED_CARD_EVAL,
  READ_ONLY_SOCIAL_CARD_CONTAINER_EVAL,
]);

/**
 * Validate the bounded adaptive exploration lane.  This lane is deliberately
 * read-only: it may discover a fresh page state, links, headings, and a
 * screenshot on an unfamiliar site, but it cannot click, type, submit, post,
 * upload, download, or delete anything.  Effectful operations remain behind
 * the target-bound operation/approval/readback contract.
 */
export function validateBrowserUseCliReadOnlyBatchCommands(commands) {
  if (!Array.isArray(commands) || commands.length < 1 || commands.length > 8) {
    throw p6RedactedError("browser_use_cli_read_only_batch_commands_invalid");
  }
  const normalized = commands.map((entry) => {
    if (!Array.isArray(entry) || entry.length === 0 || typeof entry[0] !== "string") {
      throw p6RedactedError("browser_use_cli_read_only_batch_command_invalid");
    }
    const command = entry.map((value) => String(value));
    const name = command[0];
    if (!BROWSER_USE_CLI_READ_ONLY_BATCH_COMMANDS.has(name)) {
      if (name !== "eval" || command.length !== 2 || !BROWSER_USE_CLI_READ_ONLY_BATCH_EVALS.has(command[1])) {
        throw p6RedactedError("browser_use_cli_read_only_batch_effectful_command_rejected", { action: name });
      }
    }
    if (name === "get" && command.length !== 2) throw p6RedactedError("browser_use_cli_read_only_batch_get_invalid");
    if (name === "screenshot" && command.length !== 2) throw p6RedactedError("browser_use_cli_read_only_batch_screenshot_invalid");
    if (name === "eval" && command.length !== 2) throw p6RedactedError("browser_use_cli_read_only_batch_eval_invalid");
    return command;
  });
  return Object.freeze(normalized.map((command) => Object.freeze(command)));
}

export function validateBrowserUseCliFlowBinding(flow, expected = {}) {
  const contract = flow?.contract || flow;
  assertP6ContractShape(contract);
  if (flow?.descriptor_state && !["active", "continued"].includes(flow.descriptor_state)) throw p6RedactedError("browser_use_cli_descriptor_state_invalid");
  if (flow?.lease_state && flow.lease_state !== "held") throw p6RedactedError("browser_use_cli_flow_released");
  for (const field of ["automationId", "runId", "stepId", "attemptId", "requestedSession", "effectiveSession"]) {
    if (expected[field] !== undefined && String(contract[field === "automationId" ? "automation_id" : field === "runId" ? "run_id" : field === "stepId" ? "step_id" : field === "attemptId" ? "attempt_id" : field === "requestedSession" ? "requested_session" : "effective_session"]) !== String(expected[field])) throw p6RedactedError("browser_use_cli_flow_owner_mismatch", { field });
  }
  if (expected.generation !== undefined && Number(contract.generation) !== Number(expected.generation)) throw p6RedactedError("browser_use_cli_generation_mismatch");
  if (expected.adapterSha256 && String(contract.adapter_sha256) !== String(expected.adapterSha256)) throw p6RedactedError("browser_use_cli_adapter_digest_mismatch");
  if (String(contract.adapter_sha256) !== currentAdapterSha256()) throw p6RedactedError("browser_use_cli_adapter_digest_mismatch");
  if (expected.authoritySha256 && String(contract.authority.sha256) !== String(expected.authoritySha256)) throw p6RedactedError("browser_use_cli_authority_mismatch");
  if (expected.originDigest && String(contract.normalized_origin_digest) !== String(expected.originDigest)) throw p6RedactedError("browser_use_cli_origin_mismatch");
  return contract;
}

export function validateBrowserUseCliFlowLease(lease, expected = {}) {
  if (!lease || typeof lease !== "object" || lease.schema !== BROWSER_USE_CLI_FLOW_LEASE_SCHEMA) throw p6RedactedError("browser_use_cli_flow_lease_schema_mismatch");
  if (lease.status !== "held") throw p6RedactedError("browser_use_cli_flow_lease_released");
  const contract = lease.contract || lease;
  assertP6ContractShape(contract);
  if (lease.flow_id !== contract.flow_id || lease.lease_id !== contract.lease_id || Number(lease.generation) !== Number(contract.generation)) throw p6RedactedError("browser_use_cli_flow_lease_binding_invalid");
  if (lease.owner?.run_id !== contract.run_id || lease.owner?.step_id !== contract.step_id || lease.owner?.attempt_id !== contract.attempt_id) throw p6RedactedError("browser_use_cli_flow_lease_owner_mismatch");
  const sessionBinding = lease.session_binding || lease.session || {};
  if (sessionBinding.requested !== contract.requested_session || sessionBinding.effective !== contract.effective_session) throw p6RedactedError("browser_use_cli_flow_lease_session_mismatch");
  if (lease.authority_digest !== contract.authority.sha256 || lease.adapter_sha256 !== contract.adapter_sha256 || lease.runtime_digest !== contract.runtime.home_digest || lease.origin_digest !== contract.normalized_origin_digest) throw p6RedactedError("browser_use_cli_flow_lease_digest_mismatch");
  if (Number(lease.action_sequence) !== Number(contract.action_sequence)) throw p6RedactedError("browser_use_cli_flow_lease_sequence_mismatch");
  if (expected.generation !== undefined && Number(lease.generation) !== Number(expected.generation)) throw p6RedactedError("browser_use_cli_generation_mismatch");
  return lease;
}

function assertStrictKeys(value, allowed, code, additionalFieldCode = "browser_use_cli_start_descriptor_additional_field") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw exactError(code);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw exactError(additionalFieldCode, { field: key });
  }
}

function assertCanonicalPath(value, root, code, { allowMissing = false } = {}) {
  const resolved = String(value || "");
  const canonicalRoot = path.resolve(root);
  if (!path.isAbsolute(resolved) || resolved !== path.resolve(resolved) || !resolved.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw exactError(code);
  }
  if (!allowMissing) {
    try { if (fs.realpathSync(resolved) !== resolved) throw exactError(code); } catch (error) { if (error?.exact_blocker) throw error; throw exactError(code); }
  }
  return resolved;
}

function assertOwnerMode(filePath, mode, code) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== (process.getuid?.() ?? stat.uid) || (stat.mode & 0o777) !== mode) {
    throw exactError(code);
  }
  return stat;
}

function assertDirectoryOwnerMode(dirPath, mode, code) {
  const stat = fs.lstatSync(dirPath);
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== (process.getuid?.() ?? stat.uid) || (stat.mode & 0o777) !== mode) {
    throw exactError(code);
  }
  return stat;
}

function helperSnapshotMatches(descriptor) {
  const snapshot = descriptor.helper_snapshot_path;
  if (snapshot === undefined || snapshot === null || snapshot === "") return false;
  const recordingDir = String(descriptor.recording?.recording_dir || "");
  const generationRoot = path.join(path.resolve(recordingDir), ".helper-generation");
  const expected = path.join(generationRoot, "codex-browser-use");
  if (String(snapshot) !== expected && !String(snapshot).startsWith(`${generationRoot}${path.sep}`)) return false;
  try {
    assertCanonicalPath(snapshot, recordingDir, "browser_use_cli_helper_snapshot_path_invalid");
    assertOwnerMode(snapshot, 0o700, "browser_use_cli_helper_snapshot_invalid");
    return sha256File(snapshot) === String(descriptor.helper_sha256 || "");
  } catch (_) {
    return false;
  }
}

function profileLockPath(profile) {
  return path.join(BROWSER_USE_LOCKS_ROOT, `profile-${sha256Text(profile).slice(0, 24)}.lock`);
}

function normalizeProcessIdentity(value) {
  const source = value && typeof value === "object" ? value : {};
  const pid = Number(source.root_pid ?? source.pid);
  const startTime = Number(source.root_start_time ?? source.start_time);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(startTime) || startTime <= 0) {
    throw exactError("browser_use_cli_start_descriptor_process_identity_invalid");
  }
  const ownerUid = Number(source.owner_uid);
  const cmdlineDigest = String(source.cmdline_digest || "");
  if (!Number.isInteger(ownerUid) || ownerUid < 0 || !/^[a-f0-9]{16,128}$/u.test(cmdlineDigest)) {
    throw exactError("browser_use_cli_start_descriptor_process_identity_incomplete");
  }
  return {
    pid: Number(source.pid ?? pid),
    start_time: Number(source.start_time ?? startTime),
    root_pid: pid,
    root_start_time: startTime,
    owner_uid: ownerUid,
    cmdline_digest: cmdlineDigest,
  };
}

function normalizeDescriptor(raw, expected) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw exactError("browser_use_cli_start_descriptor_invalid");
  const descriptor = raw.schema === BROWSER_USE_CLI_START_DESCRIPTOR_SCHEMA
    ? raw
    : {
      schema: BROWSER_USE_CLI_START_DESCRIPTOR_SCHEMA,
      browser_surface: BROWSER_USE_CLI_SURFACE,
      mode: raw.mode,
      lifecycle: raw.lifecycle,
      automation_id: raw.automation_id,
      run_id: raw.run_id,
      stage_id: expected.stageId,
      requested_session: raw.requested_session || raw.session,
      effective_session: raw.session,
      nonce: raw.nonce,
      helper_sha256: raw.helper_sha256,
      profile: raw.profile,
      download_dir: raw.download_dir,
      port: raw.port,
      lock_paths: raw.lock_paths,
      process: raw.process,
      loopback_listener: raw.loopback_listener || { host: "127.0.0.1", port: raw.port, verified: false },
      recording: {
        active: raw.status === "active" || raw.status === "continued",
        recording_dir: raw.recording_dir,
        status_path: raw.status_path,
      },
      helper_snapshot_path: raw.helper_snapshot_path,
      allowed_origins: raw.target_origins || raw.allowed_origins,
      authority_digest: raw.authority_sha256 || expected.authorityDigest || "public_manifest_only",
      expires_at: raw.expires_at || expected.expiresAt,
    };
  const allowed = new Set([
    "schema", "browser_surface", "mode", "lifecycle", "automation_id", "run_id", "stage_id",
    "requested_session", "effective_session", "nonce", "helper_sha256", "profile", "download_dir", "port", "lock_paths",
    "process", "loopback_listener", "recording", "helper_snapshot_path", "allowed_origins", "authority_digest", "expires_at",
  ]);
  assertStrictKeys(descriptor, allowed, "browser_use_cli_start_descriptor_invalid");
  const required = ["browser_surface", "mode", "lifecycle", "automation_id", "run_id", "stage_id", "requested_session", "effective_session", "nonce", "profile", "download_dir", "port", "lock_paths", "process", "loopback_listener", "recording", "allowed_origins", "authority_digest", "expires_at"];
  for (const field of required) if (descriptor[field] === undefined || descriptor[field] === null || descriptor[field] === "") throw exactError("browser_use_cli_start_descriptor_field_missing", { field });
  if (descriptor.browser_surface !== BROWSER_USE_CLI_SURFACE || descriptor.mode !== "public" || descriptor.lifecycle !== "single-use" || descriptor.automation_id !== expected.automationId || descriptor.run_id !== expected.runId || descriptor.stage_id !== expected.stageId || descriptor.requested_session !== expected.requestedSession || descriptor.effective_session !== expected.effectiveSession) throw exactError("browser_use_cli_start_descriptor_binding_mismatch");
  if (descriptor.port !== expected.port || descriptor.port !== P5_PUBLIC_PORT || !Array.isArray(descriptor.allowed_origins) || descriptor.allowed_origins.length !== 1 || descriptor.allowed_origins[0] !== P5_PUBLIC_ORIGIN) throw exactError("browser_use_cli_start_descriptor_binding_mismatch");
  if (!/^[a-f0-9]{32}$/u.test(String(descriptor.nonce))) throw exactError("browser_use_cli_start_descriptor_nonce_invalid");
  if (descriptor.helper_sha256 !== undefined && !/^[a-f0-9]{64}$/u.test(String(descriptor.helper_sha256))) throw exactError("browser_use_cli_helper_hash_invalid");
  const helperHashMatches = descriptor.helper_sha256 === expected.helperSha256 && /^[a-f0-9]{64}$/u.test(String(descriptor.helper_sha256));
  if (descriptor.helper_snapshot_path !== undefined && !helperSnapshotMatches(descriptor)) throw exactError("browser_use_cli_helper_snapshot_invalid");
  // The current canonical helper hash is the only trust decision.  A
  // run-pinned snapshot remains useful as historical evidence and for
  // explicit recovery, but it must never satisfy a current helper mismatch.
  if (expected.requireHelperHash === true && !helperHashMatches) throw exactError("browser_use_cli_helper_hash_mismatch");
  const profilePrefix = path.join(BROWSER_USE_SINGLE_USE_PROFILES_ROOT, `${expected.runId}-`);
  const downloadPrefix = path.join(BROWSER_USE_DOWNLOADS_ROOT, `${expected.runId}-`);
  const profileName = path.basename(descriptor.profile);
  const downloadName = path.basename(descriptor.download_dir);
  if (!descriptor.profile.startsWith(profilePrefix) || !/^[a-f0-9]{32}$/u.test(profileName.slice(expected.runId.length + 1))
    || !descriptor.download_dir.startsWith(downloadPrefix) || !/^[a-f0-9]{32}$/u.test(downloadName.slice(expected.runId.length + 1))) {
    throw exactError("browser_use_cli_start_descriptor_profile_binding_mismatch");
  }
  if (!Array.isArray(descriptor.lock_paths) || descriptor.lock_paths.length !== 2 || descriptor.lock_paths[0] !== profileLockPath(descriptor.profile) || descriptor.lock_paths[1] !== path.join(BROWSER_USE_LOCKS_ROOT, `port-${expected.port}.lock`)) throw exactError("browser_use_cli_start_descriptor_lock_binding_mismatch");
  const processIdentity = normalizeProcessIdentity(descriptor.process);
  const loopback = descriptor.loopback_listener;
  if (!loopback || loopback.host !== "127.0.0.1" || loopback.port !== expected.port || loopback.verified !== true) throw exactError("browser_use_cli_start_descriptor_listener_binding_mismatch");
  const recording = descriptor.recording;
  if (!recording || recording.active !== true || typeof recording.recording_dir !== "string" || typeof recording.status_path !== "string") throw exactError("browser_use_cli_start_descriptor_recording_not_active");
  const expiresMs = Date.parse(String(descriptor.expires_at));
  if (!Number.isFinite(expiresMs) || expiresMs <= 0 || (expected.verifyExpiry !== false && expiresMs <= Date.now())) throw exactError("browser_use_cli_start_descriptor_expired");
  return Object.freeze({
    schema: BROWSER_USE_CLI_START_DESCRIPTOR_SCHEMA,
    browser_surface: descriptor.browser_surface,
    mode: descriptor.mode,
    lifecycle: descriptor.lifecycle,
    automation_id: descriptor.automation_id,
    run_id: descriptor.run_id,
    stage_id: descriptor.stage_id,
    requested_session: descriptor.requested_session,
    effective_session: descriptor.effective_session,
    nonce: descriptor.nonce,
    helper_sha256: descriptor.helper_sha256 || null,
    helper_snapshot_path: descriptor.helper_snapshot_path || null,
    profile: descriptor.profile,
    download_dir: descriptor.download_dir,
    port: descriptor.port,
    lock_paths: Object.freeze([...descriptor.lock_paths]),
    process: Object.freeze(processIdentity),
    loopback_listener: Object.freeze({ host: loopback.host, port: loopback.port, verified: true }),
    recording: Object.freeze({ active: true, recording_dir: recording.recording_dir, status_path: recording.status_path }),
    allowed_origins: Object.freeze([...descriptor.allowed_origins]),
    authority_digest: String(descriptor.authority_digest),
    expires_at: String(descriptor.expires_at),
  });
}

export function parseBrowserUseCliStartDescriptor(raw, expected = {}) {
  const expectedSession = String(expected.requestedSession || expected.effectiveSession || "");
  return normalizeDescriptor(raw, {
    automationId: String(expected.automationId || ""),
    runId: String(expected.runId || ""),
    stageId: String(expected.stageId || ""),
    requestedSession: expectedSession,
    effectiveSession: String(expected.effectiveSession || expectedSession),
    port: Number(expected.port || P5_PUBLIC_PORT),
    authorityDigest: String(expected.authorityDigest || "public_manifest_only"),
    helperSha256: String(expected.helperSha256 || sha256File(BROWSER_USE_CLI_HELPER)),
    requireHelperHash: expected.requireHelperHash === true,
    expiresAt: String(expected.expiresAt || new Date(Date.now() + 5 * 60 * 1000).toISOString()),
    verifyExpiry: expected.verifyExpiry !== false,
  });
}

export function validateBrowserUseCliLifecycleState(current, event) {
  const transitions = {
    idle: { start: "started" },
    started: { command: "commanded" },
    commanded: { readback: "readback" },
    readback: { finalize: "finalized" },
  };
  if (current === "finalized" && event === "command") throw exactError("browser_use_cli_lifecycle_replay_rejected");
  if (current === "commanded" && event === "command") throw exactError("browser_use_cli_lifecycle_concurrent_command_rejected");
  const next = transitions[current]?.[event];
  if (!next) throw exactError(current === "idle" && event === "command" ? "browser_use_cli_lifecycle_start_required" : "browser_use_cli_lifecycle_transition_invalid");
  return next;
}

export function validateBrowserUseCliSemanticReadback(readback) {
  if (!readback || typeof readback !== "object" || Array.isArray(readback)) throw exactError("browser_use_cli_semantic_readback_invalid");
  const allowed = new Set(["schema", "url", "url_sha256", "origin", "origin_sha256", "title_sha256", "title_length", "state", "state_sha256", "redirect_hops", "redirect_count", "final_dns_resolution"]);
  assertStrictKeys(readback, allowed, "browser_use_cli_semantic_readback_invalid", "browser_use_cli_semantic_readback_additional_field");
  if (readback.schema !== BROWSER_USE_CLI_SEMANTIC_READBACK_SCHEMA || readback.url !== "https://example.com/" || readback.url_sha256 !== sha256Text(readback.url) || readback.origin !== "https://example.com" || readback.origin_sha256 !== sha256Text(readback.origin) || readback.title_sha256 !== "162b81548a8db0ab220f7137405fb003019c266883d4181869662ad7eafdbc4d" || readback.title_length !== 14 || readback.redirect_count !== 0 || !Array.isArray(readback.redirect_hops) || readback.redirect_hops.length !== 0) throw exactError("browser_use_cli_semantic_readback_expectation_mismatch");
  const state = readback.state;
  if (!state || typeof state !== "object" || Array.isArray(state) || state.ready_state !== "complete" || state.url !== readback.url || state.origin !== readback.origin || state.redirect_count !== 0 || state.dns_revalidation !== true || state.dns_private_address_count !== 0 || state.dns_link_local_address_count !== 0 || state.dns_loopback_address_count !== 0) throw exactError("browser_use_cli_semantic_readback_state_mismatch");
  const stateValue = {
    ready_state: state.ready_state,
    url: state.url,
    origin: state.origin,
    redirect_count: state.redirect_count,
    dns_revalidation: state.dns_revalidation,
    dns_private_address_count: state.dns_private_address_count,
    dns_link_local_address_count: state.dns_link_local_address_count,
    dns_loopback_address_count: state.dns_loopback_address_count,
  };
  const stateDigest = sha256Text(JSON.stringify(Object.fromEntries(Object.entries(stateValue).sort())));
  if (readback.state_sha256 !== stateDigest || !readback.final_dns_resolution || readback.final_dns_resolution.public_only !== true || readback.final_dns_resolution.private_address_count !== 0 || readback.final_dns_resolution.link_local_address_count !== 0 || readback.final_dns_resolution.loopback_address_count !== 0) throw exactError("browser_use_cli_semantic_readback_dns_mismatch");
  return Object.freeze({ ...readback, state: Object.freeze({ ...state }), final_dns_resolution: Object.freeze({ ...readback.final_dns_resolution }) });
}

function readProcessSnapshot(pid) {
  try {
    const output = execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart=,uid=,command="], { encoding: "utf8", timeout: 5000 }).trim();
    const match = output.match(/^(.{24})\s+(\d+)\s+(.+)$/u);
    if (!match) throw new Error("process_snapshot_invalid");
    const ownerUid = Number(match[2]);
    const command = match[3];
    return { owner_uid: ownerUid, cmdline_digest: sha256Text(command), command, start_time: Date.parse(match[1]) / 1000 };
  } catch {
    throw exactError("browser_use_cli_start_descriptor_process_readback_failed");
  }
}

function verifyLoopbackListener(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

function verifyDescriptorFilesystem(descriptor) {
  assertCanonicalPath(descriptor.profile, BROWSER_USE_SINGLE_USE_PROFILES_ROOT, "browser_use_cli_start_descriptor_profile_path_invalid");
  assertCanonicalPath(descriptor.download_dir, BROWSER_USE_DOWNLOADS_ROOT, "browser_use_cli_start_descriptor_download_path_invalid");
  assertCanonicalPath(descriptor.recording.recording_dir, p6RecordingsRoot(), "browser_use_cli_start_descriptor_recording_path_invalid");
  assertCanonicalPath(descriptor.recording.status_path, descriptor.recording.recording_dir, "browser_use_cli_start_descriptor_recording_status_path_invalid");
  assertDirectoryOwnerMode(descriptor.profile, 0o700, "browser_use_cli_start_descriptor_profile_runtime_invalid");
  assertDirectoryOwnerMode(descriptor.recording.recording_dir, 0o700, "browser_use_cli_start_descriptor_recording_runtime_invalid");
  assertOwnerMode(descriptor.recording.status_path, 0o600, "browser_use_cli_start_descriptor_recording_status_invalid");
  const status = JSON.parse(fs.readFileSync(descriptor.recording.status_path, "utf8"));
  if (status?.recorder_active !== true || status?.finalized === true) throw exactError("browser_use_cli_start_descriptor_recording_not_active");
  const markerPath = path.join(descriptor.profile, ".browser-use-profile.json");
  assertOwnerMode(markerPath, 0o600, "browser_use_cli_start_descriptor_profile_marker_invalid");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  if (marker?.run_id !== descriptor.run_id || marker?.nonce !== descriptor.nonce) throw exactError("browser_use_cli_start_descriptor_profile_marker_mismatch");
  for (const lockPath of descriptor.lock_paths) {
    assertOwnerMode(lockPath, 0o600, "browser_use_cli_start_descriptor_lock_runtime_invalid");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (lock?.run_id !== descriptor.run_id || lock?.nonce !== descriptor.nonce || lock?.port !== descriptor.port || lock?.canonical_profile !== descriptor.profile) throw exactError("browser_use_cli_start_descriptor_lock_owner_mismatch");
  }
  const processSnapshot = readProcessSnapshot(descriptor.process.root_pid);
  if (processSnapshot.owner_uid !== descriptor.process.owner_uid || Math.abs(processSnapshot.start_time - descriptor.process.root_start_time) > 30 || processSnapshot.cmdline_digest !== descriptor.process.cmdline_digest || !processSnapshot.command.includes("--remote-debugging-port=19980") || !processSnapshot.command.includes(`--user-data-dir=${descriptor.profile}`)) throw exactError("browser_use_cli_start_descriptor_process_binding_mismatch");
  return verifyLoopbackListener(descriptor.port).then((listener) => {
    if (!listener) throw exactError("browser_use_cli_start_descriptor_listener_readback_failed");
    return descriptor;
  });
}

function safeIdentifier(value, field) {
  const result = String(value ?? "").trim();
  if (!IDENTIFIER.test(result)) throw exactError(`browser_use_cli_${field}_invalid`);
  return result;
}

function assertAbsoluteRegularFile(filePath, code) {
  const resolved = path.resolve(String(filePath || ""));
  if (!path.isAbsolute(String(filePath || "")) || fs.realpathSync(resolved) !== resolved) {
    throw exactError(code);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw exactError(code);
  return resolved;
}

function normalizeCommands({ command, commands }) {
  const selected = Array.isArray(commands) && commands.length > 0
    ? commands
    : [command];
  if (!Array.isArray(selected) || selected.length === 0) {
    throw exactError("browser_use_cli_commands_required");
  }
  return selected.map((entry) => {
    if (!Array.isArray(entry) || entry.length === 0 || typeof entry[0] !== "string") {
      throw exactError("browser_use_cli_command_invalid");
    }
    const normalized = entry.map((value) => String(value));
    if (normalized[0].startsWith("-")) throw exactError("browser_use_cli_command_invalid");
    return normalized;
  });
}

function originOf(value) {
  try {
    const url = new URL(String(value));
    if (!/^https?:$/u.test(url.protocol) || url.username || url.password || url.search || url.hash) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function publicCommand(command) {
  const name = command[0];
  return {
    name,
    argument_count: Math.max(0, command.length - 1),
    origins: [...new Set(command.map(originOf).filter(Boolean))].sort(),
  };
}

function parseLastJson(output) {
  const lines = String(output || "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_) {
      // The helper is expected to emit one JSON line, but keep the adapter
      // fail-closed if a future CLI version writes a diagnostic before it.
    }
  }
  return null;
}

function appendBounded(buffer, chunk) {
  const next = `${buffer}${String(chunk || "")}`;
  return next.length <= MAX_OUTPUT_BYTES ? next : next.slice(-MAX_OUTPUT_BYTES);
}

function spawnHelper(args, { timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(BROWSER_USE_CLI_HELPER, args, {
      cwd: path.dirname(BROWSER_USE_RUNTIME_CONFIG),
      env: browserUseCliChildEnvironment(process.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeoutGraceTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timeoutGraceTimer) clearTimeout(timeoutGraceTimer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Give the helper a bounded chance to flush its JSON result and close
      // its transport before classifying cleanup as unverified. Same-run
      // recovery is still required by the caller after this grace period.
      timeoutGraceTimer = setTimeout(() => {
        finish({ code: null, signal: "SIGTERM", timed_out: true, child_exited: false, stdout, stderr });
      }, HELPER_TIMEOUT_GRACE_MS);
    }, Math.max(1, Number(timeoutMs || DEFAULT_TIMEOUT_MS)));
    child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.on("error", (error) => finish({ code: null, signal: null, spawn_error: error.code || "spawn_error", timed_out: timedOut, stdout, stderr }));
    child.on("close", (code, signal) => finish({ code, signal, timed_out: timedOut, child_exited: true, stdout, stderr }));
  });
}

/** Test-only command transport seam. It is reached only after all flow,
 * authority, recorder, origin, action, lease, and descriptor checks. */
export function setBrowserUseCliTestCommandInvokerForTests(invoker = null) {
  if (invoker !== null && typeof invoker !== "function") throw p6RedactedError("browser_use_cli_test_injector_invalid");
  if (invoker !== null && process.env.CODEX_BROWSER_USE_TEST_SEAM !== "1") throw p6RedactedError("browser_use_cli_test_injector_disabled");
  p6TestCommandInvoker = invoker;
  return () => { if (p6TestCommandInvoker === invoker) p6TestCommandInvoker = null; };
}

function invokeFlowCommand(args, options) {
  if (p6TestCommandInvoker) {
    if (process.env.CODEX_BROWSER_USE_TEST_SEAM !== "1") throw p6RedactedError("browser_use_cli_test_injector_disabled");
    return Promise.resolve(p6TestCommandInvoker(Object.freeze([...args]), Object.freeze({ ...options }))).then((result) => ({ ...result, transport: browserUseCliTransportMarker({ viaTestSeam: true }) }));
  }
  return spawnHelper(args, options);
}

const HELPER_REFRESH_READ_ONLY_COMMANDS = new Set(["state", "get", "screenshot", "extract", "wait"]);

async function recoverFlowAfterTransportTimeout({ flow, authorityPath = "", timeoutMs = RECOVERY_TIMEOUT_MS } = {}) {
  const contract = validateBrowserUseCliFlowBinding(flow, { authoritySha256: flow.contract.authority?.sha256 });
  const args = [
    "record-recover",
    "--run-id", contract.run_id,
    "--session", contract.effective_session,
    "--descriptor", flow.descriptor_path,
    "--max-attempts", "1",
  ];
  if (contract.authority.mode === "authorized") args.push("--authority", authorityPath || contract.authority.reference, "--auto-renew");
  const result = await invokeFlowCommand(args, { timeoutMs, phase: "record-recover" });
  const parsed = parseHelperResult(result, "recording_recovered", "browser_use_cli_flow_recovery_failed");
  return {
    status: parsed.helper?.status || "blocked",
    exactBlocker: parsed.exactBlocker || "",
    helper: parsed.helper,
    childExited: result.child_exited !== false,
  };
}

export function parseHelperResult(result, expectedStatus, fallbackBlocker, { allowFinalized = false } = {}) {
  // The canonical helper normally writes one JSON receipt to stdout, but a
  // startup/argument failure can be emitted on stderr by the Python entry
  // point. Parse both streams so the adapter keeps the exact blocker while
  // never persisting arbitrary diagnostics or page data.
  const helper = parseLastJson(result.stdout) || parseLastJson(result.stderr);
  if (result.code !== 0 || !helper || helper.status !== expectedStatus || (!allowFinalized && helper.finalized === true)) {
    return { helper, exactBlocker: helper?.exact_blocker || (result.timed_out ? "browser_use_cli_helper_timeout_cleanup_unverified" : result.spawn_error || fallbackBlocker) };
  }
  return { helper, exactBlocker: "", transport: result.transport || browserUseCliTransportMarker() };
}

function flowContractAfterAuthorityRenewal(contract, helper) {
  const digest = String(helper?.authority_sha256 || "");
  const reference = String(helper?.authority_current_path || "");
  const expiresAt = String(helper?.authority_expires_at || "");
  if (!digest && !reference && !expiresAt) return contract;
  if (!/^[a-f0-9]{64}$/u.test(digest) || !reference || !path.isAbsolute(reference) || !expiresAt) {
    throw p6RedactedError("browser_use_cli_authority_renewal_readback_invalid");
  }
  const authority = Object.freeze({
    ...contract.authority,
    reference: path.resolve(reference),
    sha256: digest,
  });
  return Object.freeze({
    ...contract,
    authority,
    expires_at: expiresAt,
  });
}

function readJsonFileStrict(filePath, code) {
  assertOwnerMode(filePath, 0o600, code);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw exactError(code);
  }
}

export function validateBrowserUseCliTabInventory(value, { maxAuxiliaryTabs = BROWSER_USE_DEFAULT_MAX_AUXILIARY_TABS, maxBaselineTabs = BROWSER_USE_DEFAULT_MAX_AUXILIARY_TABS } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== BROWSER_USE_TAB_INVENTORY_SCHEMA) {
    throw exactError("browser_use_cli_tab_inventory_invalid");
  }
  const tabs = Array.isArray(value.tabs) ? value.tabs.filter((tab) => tab && typeof tab === "object") : [];
  const ids = tabs.map((tab) => String(tab.target_id || "")).filter(Boolean);
  const uniqueIds = new Set(ids);
  const workingTargetId = String(value.working_target_id || "");
  const activeTargetId = String(value.active_target_id || workingTargetId);
  const baselineTargetIds = Array.isArray(value.baseline_target_ids) ? value.baseline_target_ids.map(String).filter(Boolean) : [];
  const auxiliaryTargetIds = Array.isArray(value.auxiliary_target_ids) ? value.auxiliary_target_ids.map(String).filter(Boolean) : [];
  if (!workingTargetId || !uniqueIds.has(workingTargetId) || !activeTargetId || !uniqueIds.has(activeTargetId)) {
    throw exactError("browser_use_cli_working_tab_readback_invalid");
  }
  if (uniqueIds.size !== ids.length || new Set(baselineTargetIds).size !== baselineTargetIds.length || new Set(auxiliaryTargetIds).size !== auxiliaryTargetIds.length) {
    throw exactError("browser_use_cli_tab_inventory_duplicate_id");
  }
  if (baselineTargetIds.includes(workingTargetId) || auxiliaryTargetIds.includes(workingTargetId) || baselineTargetIds.some((id) => auxiliaryTargetIds.includes(id))) {
    throw exactError("browser_use_cli_tab_inventory_role_conflict");
  }
  const rolesById = new Map(tabs.map((tab) => [String(tab.target_id || ""), String(tab.role || "")]));
  if (rolesById.get(activeTargetId) === "baseline") {
    throw exactError("browser_use_cli_active_tab_foreign_baseline");
  }
  if (!Number.isSafeInteger(Number(maxBaselineTabs)) || Number(maxBaselineTabs) < 0 || baselineTargetIds.length > Number(maxBaselineTabs)) {
    throw exactError("browser_use_cli_unexpected_baseline_tab_growth");
  }
  if (!Number.isSafeInteger(Number(maxAuxiliaryTabs)) || Number(maxAuxiliaryTabs) < 0 || auxiliaryTargetIds.length > Number(maxAuxiliaryTabs)) {
    throw exactError("browser_use_cli_unexpected_auxiliary_tab_growth");
  }
  return Object.freeze({
    schema: BROWSER_USE_TAB_INVENTORY_SCHEMA,
    working_target_id: workingTargetId,
    active_target_id: activeTargetId,
    command_target_id: value.command_target_id ? String(value.command_target_id) : null,
    baseline_target_ids: Object.freeze([...baselineTargetIds]),
    auxiliary_target_ids: Object.freeze([...auxiliaryTargetIds]),
    tabs: Object.freeze(tabs.map((tab) => Object.freeze({
      target_id: String(tab.target_id),
      role: String(tab.role || ""),
      url_length: Number(tab.url_length || 0),
      url_sha256: String(tab.url_sha256 || ""),
      title_length: Number(tab.title_length || 0),
      title_sha256: String(tab.title_sha256 || ""),
    }))),
    tab_count: tabs.length,
    updated_at: value.updated_at ?? null,
  });
}

function readBrowserUseCliFlowTabInventory(flow) {
  const required = String(flow?.contract?.tab_management || "") === "single_working_tab";
  const inventoryPath = String(flow?.tab_inventory_path || path.join(String(flow?.recording_dir || ""), "tab-inventory.json"));
  if (!inventoryPath || !path.isAbsolute(inventoryPath) || !fs.existsSync(inventoryPath)) {
    if (required) throw exactError("browser_use_cli_tab_inventory_missing");
    return null;
  }
  const inventory = validateBrowserUseCliTabInventory(
    readJsonFileStrict(inventoryPath, "browser_use_cli_tab_inventory_invalid"),
    {
      maxAuxiliaryTabs: Number(flow?.contract?.max_auxiliary_tabs ?? BROWSER_USE_DEFAULT_MAX_AUXILIARY_TABS),
      maxBaselineTabs: required ? 0 : BROWSER_USE_DEFAULT_MAX_AUXILIARY_TABS,
    },
  );
  return Object.freeze({ ...inventory, path: inventoryPath });
}

async function enrichAndValidateStartDescriptor({ descriptorPath, automationId, runId, stageId, requestedSession, port, expiresAt, authorityDigest, helperSha256 = sha256File(BROWSER_USE_CLI_HELPER), verifyFilesystem = true } = {}) {
  const resolvedDescriptorPath = path.resolve(String(descriptorPath || ""));
  assertCanonicalPath(resolvedDescriptorPath, p6RecordingsRoot(), "browser_use_cli_start_descriptor_path_invalid");
  assertOwnerMode(resolvedDescriptorPath, 0o600, "browser_use_cli_start_descriptor_path_invalid");
  const rawText = fs.readFileSync(resolvedDescriptorPath, "utf8");
  const raw = JSON.parse(rawText);
  const rawProcess = raw?.process || {};
  const rootPid = Number(rawProcess.root_pid ?? rawProcess.pid);
  const snapshot = readProcessSnapshot(rootPid);
  const listenerVerified = await verifyLoopbackListener(Number(raw?.port || port));
  const enriched = {
    ...raw,
    stage_id: stageId,
    authority_sha256: raw.authority_sha256 || authorityDigest || "public_manifest_only",
    expires_at: raw.expires_at || expiresAt,
    loopback_listener: { host: "127.0.0.1", port: Number(raw?.port || port), verified: listenerVerified },
    process: {
      ...rawProcess,
      owner_uid: snapshot.owner_uid,
      cmdline_digest: snapshot.cmdline_digest,
    },
  };
  const effectiveSession = String(raw?.session || "");
  const descriptor = parseBrowserUseCliStartDescriptor(enriched, {
    automationId,
    runId,
    stageId,
    requestedSession,
    effectiveSession,
    port,
    authorityDigest,
    helperSha256,
    requireHelperHash: true,
    expiresAt,
  });
  if (verifyFilesystem) await verifyDescriptorFilesystem(descriptor);
  return {
    descriptor,
    descriptorPath: resolvedDescriptorPath,
    descriptorDigest: sha256Text(rawText),
  };
}

function isP5PublicLifecycleRequest(request, { port } = {}) {
  return request.mode === "public"
    && request.lifecycle === "single-use"
    && Number(port) === P5_PUBLIC_PORT
    && request.commands.length === 1
    && request.commands[0].length === 2
    && request.commands[0][0] === "open"
    && request.commands[0][1] === P5_PUBLIC_ORIGIN
    && request.postCommands.length === P5_READBACK_COMMANDS.length
    && request.postCommands.every((entry, index) => entry.length === P5_READBACK_COMMANDS[index].length && entry.every((value, valueIndex) => value === P5_READBACK_COMMANDS[index][valueIndex]))
    && request.authorityPath === "";
}

async function runP5PublicLifecycle({ request, automationId, runId, stageId, session, port, allowedOrigins, authorityDigest = "public_manifest_only", expiresAt = "", artifactDir, timeoutMs } = {}) {
  if (BROWSER_USE_CLI_P5_PUBLIC_LIFECYCLE_QUARANTINED) throw p6RedactedError("browser_use_cli_p5_public_lifecycle_quarantined");
  const observation = {
    schema: BROWSER_USE_CLI_ADAPTER_SCHEMA,
    browser_surface: BROWSER_USE_CLI_SURFACE,
    automation_id: automationId,
    run_id: runId,
    stage_id: stageId,
    session,
    lifecycle: "single-use",
    mode: "public",
    command_count: 1,
    commands: request.commands.map(publicCommand),
    external_action_executed: false,
    helper_launched: false,
    cleanup_verified: false,
    helper_sha256: sha256File(BROWSER_USE_CLI_HELPER),
    status: "blocked",
    exact_blocker: "",
    receipts: [],
    captured_readback: {},
    lifecycle_state: "idle",
    authority_digest: authorityDigest,
  };
  const expiresAtMs = Date.parse(String(expiresAt));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    observation.exact_blocker = "browser_use_cli_runtime_approval_expired";
    observation.artifact_uri = writeObservation(artifactDir, observation);
    return observation;
  }
  const recordingDir = path.join(BROWSER_USE_RECORDINGS_ROOT, runId);
  if (path.resolve(recordingDir) !== recordingDir || !recordingDir.startsWith(`${BROWSER_USE_RECORDINGS_ROOT}${path.sep}`)) {
    observation.exact_blocker = "browser_use_cli_recording_root_invalid";
    observation.artifact_uri = writeObservation(artifactDir, observation);
    return observation;
  }
  let recordingDirExists = false;
  try {
    fs.lstatSync(recordingDir);
    recordingDirExists = true;
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
  }
  if (recordingDirExists) {
    try { assertDirectoryOwnerMode(recordingDir, 0o700, "browser_use_cli_recording_root_invalid"); } catch (error) { observation.exact_blocker = error.exact_blocker || "browser_use_cli_recording_root_invalid"; observation.artifact_uri = writeObservation(artifactDir, observation); return observation; }
    if (fs.readdirSync(recordingDir).length > 0) {
      observation.exact_blocker = "browser_use_cli_recording_root_not_fresh";
      observation.artifact_uri = writeObservation(artifactDir, observation);
      return observation;
    }
  }
  const startArgs = ["record-start", "--mode", "public", "--run-id", runId, "--session", session, "--automation-id", automationId, "--lifecycle", "single-use", "--port", String(port), "--allowed-origin", P5_PUBLIC_ORIGIN, "--recording-dir", recordingDir, "--", ...P5_INITIAL_COMMAND];
  const startResult = await spawnHelper(startArgs, { timeoutMs });
  observation.helper_launched = true;
  const startParsed = parseHelperResult(startResult, "recording_ready", "browser_use_cli_recording_start_failed");
  observation.receipts.push({ phase: "start", status: startParsed.helper?.status || "blocked", descriptor_path: startParsed.helper?.descriptor || "", finalized: startParsed.helper?.finalized === true, exit_status: startResult.code, exact_blocker: startParsed.exactBlocker });
  if (startParsed.exactBlocker || !startParsed.helper?.descriptor) {
    observation.exact_blocker = startParsed.exactBlocker || "browser_use_cli_start_descriptor_missing";
    observation.artifact_uri = writeObservation(artifactDir, observation);
    return observation;
  }
  observation.lifecycle_state = validateBrowserUseCliLifecycleState(observation.lifecycle_state, "start");
  let binding;
  try {
    binding = await enrichAndValidateStartDescriptor({ descriptorPath: startParsed.helper.descriptor, automationId, runId, stageId, requestedSession: session, port, expiresAt, authorityDigest });
  } catch (error) {
    observation.exact_blocker = error.exact_blocker || "browser_use_cli_start_descriptor_binding_failed";
    observation.artifact_uri = writeObservation(artifactDir, observation);
    return observation;
  }
  observation.start_descriptor = { path: binding.descriptorPath, sha256: binding.descriptorDigest, requested_session: binding.descriptor.requested_session, effective_session: binding.descriptor.effective_session, helper_sha256: binding.descriptor.helper_sha256, profile: binding.descriptor.profile, port: binding.descriptor.port, lock_paths: binding.descriptor.lock_paths, process: binding.descriptor.process, expires_at: binding.descriptor.expires_at };
  const commandResults = [];
  const semanticParts = {};
  const fixedCommands = [P5_NETWORK_COMMAND, ...P5_READBACK_COMMANDS];
  for (const [index, currentCommand] of fixedCommands.entries()) {
    if (Date.parse(binding.descriptor.expires_at) <= Date.now()) { observation.exact_blocker = "browser_use_cli_start_descriptor_expired"; break; }
    try {
      const current = await enrichAndValidateStartDescriptor({ descriptorPath: binding.descriptorPath, automationId, runId, stageId, requestedSession: session, port, expiresAt: binding.descriptor.expires_at, authorityDigest });
      if (current.descriptor.effective_session !== binding.descriptor.effective_session || current.descriptor.nonce !== binding.descriptor.nonce || current.descriptor.profile !== binding.descriptor.profile || current.descriptor.port !== binding.descriptor.port || current.descriptor.lock_paths.join("\n") !== binding.descriptor.lock_paths.join("\n") || current.descriptor.process.root_pid !== binding.descriptor.process.root_pid || current.descriptor.process.root_start_time !== binding.descriptor.process.root_start_time) throw exactError("browser_use_cli_start_descriptor_binding_changed");
      const commandArgs = ["record-command", "--run-id", runId, "--session", binding.descriptor.effective_session, "--descriptor", binding.descriptorPath, "--", ...currentCommand];
      const commandResult = { code: 1, stdout: "", stderr: "", timed_out: false, spawn_error: "browser_use_cli_legacy_target_boundary_disabled" };
      const commandParsed = parseHelperResult(commandResult, "recording_continued", "browser_use_cli_recording_command_failed");
      const commandReadback = commandParsed.helper?.readback && typeof commandParsed.helper.readback === "object" ? commandParsed.helper.readback : null;
      if (commandReadback?.kind) semanticParts[commandReadback.kind] = commandReadback;
      commandResults.push({ phase: index === 0 ? "open" : "readback", command: publicCommand(currentCommand), status: commandParsed.helper?.status || "blocked", descriptor_path: commandParsed.helper?.descriptor || "", finalized: commandParsed.helper?.finalized === true, exit_status: commandResult.code, exact_blocker: commandParsed.exactBlocker, ...(commandReadback ? { readback: commandReadback } : {}) });
      if (commandParsed.exactBlocker || commandParsed.helper?.descriptor !== binding.descriptorPath) { observation.exact_blocker = commandParsed.exactBlocker || "browser_use_cli_descriptor_substitution_rejected"; break; }
      if (index === 0) observation.lifecycle_state = validateBrowserUseCliLifecycleState(observation.lifecycle_state, "command");
      if (index === fixedCommands.length - 1) observation.lifecycle_state = validateBrowserUseCliLifecycleState(observation.lifecycle_state, "readback");
    } catch (error) {
      observation.exact_blocker = error.exact_blocker || "browser_use_cli_recording_command_failed";
      break;
    }
  }
  observation.receipts.push(...commandResults);
  if (!observation.exact_blocker && observation.lifecycle_state !== "readback") observation.exact_blocker = "browser_use_cli_semantic_readback_unavailable";
  if (!observation.exact_blocker) {
    const mergedReadback = {
      schema: BROWSER_USE_CLI_SEMANTIC_READBACK_SCHEMA,
      url: semanticParts.url?.url || "",
      url_sha256: semanticParts.url?.url_sha256 || "",
      origin: semanticParts.url?.origin || "",
      origin_sha256: semanticParts.url?.origin_sha256 || "",
      title_sha256: semanticParts.title?.title_sha256 || "",
      title_length: semanticParts.title?.title_length || 0,
      state: semanticParts.state?.state || null,
      state_sha256: semanticParts.state?.state_sha256 || "",
      redirect_hops: semanticParts.url?.redirect_hops || [],
      redirect_count: semanticParts.url?.redirect_count ?? -1,
      final_dns_resolution: semanticParts.url?.final_dns_resolution || null,
    };
    try {
      observation.semantic_readback = validateBrowserUseCliSemanticReadback(mergedReadback);
    } catch (error) {
      observation.exact_blocker = error.exact_blocker || "browser_use_cli_semantic_readback_invalid";
    }
  }
  const finalizeArgs = ["record-finalize", "--run-id", runId, "--session", binding.descriptor.effective_session, "--descriptor", binding.descriptorPath];
  const finalizeResult = await spawnHelper(finalizeArgs, { timeoutMs });
  const finalizeHelper = parseLastJson(finalizeResult.stdout);
  observation.receipts.push({ phase: "finalize", status: finalizeHelper?.status || "blocked", receipt_path: finalizeHelper?.receipt || "", manifest_path: finalizeHelper?.manifest || "", finalized: finalizeHelper?.finalized === true, exit_status: finalizeResult.code, exact_blocker: finalizeHelper?.exact_blocker || (finalizeResult.code === 0 ? "" : "browser_use_cli_recording_finalize_failed") });
  if (finalizeResult.code !== 0 || !finalizeHelper || finalizeHelper.status !== "completed" || finalizeHelper.finalized !== true) observation.exact_blocker = observation.exact_blocker || finalizeHelper?.exact_blocker || "browser_use_cli_recording_finalize_failed";
  else {
    try {
      const receipt = readJsonFileStrict(finalizeHelper.receipt, "browser_use_cli_final_receipt_invalid");
      if (receipt?.schema !== "browser-use-receipt.v1" || receipt?.run_id !== runId || receipt?.session !== binding.descriptor.effective_session || receipt?.port !== port || receipt?.finalized !== true || receipt?.authority_summary?.side_effect_scope !== "bounded_recording" || receipt?.cleanup?.status !== "cleaned") throw exactError("browser_use_cli_final_receipt_binding_failed");
      if (fs.existsSync(binding.descriptor.profile) || binding.descriptor.lock_paths.some((lockPath) => fs.existsSync(lockPath))) throw exactError("browser_use_cli_cleanup_residual_detected");
      observation.cleanup_verified = true;
      observation.final_receipt = { path: path.resolve(finalizeHelper.receipt), manifest: path.resolve(finalizeHelper.manifest || ""), finalized: true, cleanup_verified: true, external_action_executed: false };
    } catch (error) {
      observation.exact_blocker = observation.exact_blocker || error.exact_blocker || "browser_use_cli_final_receipt_binding_failed";
    }
  }
  if (!observation.exact_blocker && !observation.semantic_readback) observation.exact_blocker = "browser_use_cli_semantic_readback_unavailable";
  observation.status = observation.exact_blocker ? "blocked" : "completed";
  observation.lifecycle_state = observation.cleanup_verified ? "finalized" : observation.lifecycle_state;
  observation.artifact_uri = writeObservation(artifactDir, observation);
  return observation;
}

function assertCommandPolicy(command, mode) {
  const allowed = mode === "public" ? PUBLIC_COMMANDS : AUTHORIZED_COMMANDS;
  if (!allowed.has(command[0])) throw exactError("browser_use_cli_command_not_allowed", { command: command[0] });
  for (const token of command.slice(1)) {
    if (["--profile", "--cdp-url", "--session", "--mcp", "--template"].includes(token)
      || token.startsWith("--profile=") || token.startsWith("--cdp-url=")
      || token.startsWith("--session=")) {
      throw exactError("browser_use_cli_helper_owned_flag_rejected");
    }
  }
}

function writeObservation(artifactDir, observation) {
  if (!artifactDir) return "";
  const resolvedDir = path.resolve(String(artifactDir));
  fs.mkdirSync(resolvedDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(resolvedDir, 0o700);
  const artifactPath = path.join(resolvedDir, "browser-use-cli-stage-observation.v1.json");
  const { captured_readback: _capturedReadback, ...persistedObservation } = observation;
  const body = `${JSON.stringify({ ...persistedObservation, artifact_uri: artifactPath }, null, 2)}\n`;
  fs.writeFileSync(artifactPath, body, { mode: 0o600, flag: "wx" });
  fs.chmodSync(artifactPath, 0o600);
  return artifactPath;
}

function normalizePostCommands(postCommands, mode) {
  if (postCommands === undefined || postCommands === null) return [];
  if (!Array.isArray(postCommands) || postCommands.length > 8) {
    throw exactError("browser_use_cli_post_commands_invalid");
  }
  return postCommands.map((entry) => {
    if (!Array.isArray(entry) || entry.length === 0 || typeof entry[0] !== "string") {
      throw exactError("browser_use_cli_post_command_invalid");
    }
    const normalized = entry.map((value) => String(value));
    if (!["state", "screenshot", "get", "eval"].includes(normalized[0])) {
      throw exactError("browser_use_cli_post_command_not_read_only");
    }
    assertCommandPolicy(normalized, mode);
    if (normalized[0] === "eval" && (normalized.length !== 2 || !["location.href", "document.title", READ_ONLY_LINK_EVAL, READ_ONLY_APPLICATION_LINK_EVAL, READ_ONLY_JOB_DETAIL_EVAL, READ_ONLY_SOCIAL_LINK_EVAL, READ_ONLY_SOCIAL_CARD_EVAL, READ_ONLY_SOCIAL_FEED_CARD_EVAL, READ_ONLY_SOCIAL_CARD_CONTAINER_EVAL].includes(normalized[1]))) {
      throw exactError("browser_use_cli_post_eval_not_allowlisted");
    }
    if (normalized[0] === "screenshot" && normalized.length !== 2) {
      throw exactError("browser_use_cli_post_screenshot_path_required");
    }
    return normalized;
  });
}

export function validateBrowserUseCliStageRequest({
  automationId,
  runId,
  stageId,
  mode = "authorized",
  lifecycle = "scheduled",
  authorityPath = "",
  command,
  commands,
  postCommands = [],
} = {}) {
  safeIdentifier(automationId, "automation_id");
  safeIdentifier(runId, "run_id");
  safeIdentifier(stageId, "stage_id");
  if (!["authorized", "public"].includes(mode)) throw exactError("browser_use_cli_mode_invalid");
  if (!["scheduled", "single-use"].includes(lifecycle)) throw exactError("browser_use_cli_lifecycle_invalid");
  if (mode === "public" && lifecycle !== "single-use") throw exactError("browser_use_cli_public_requires_single_use");
  if (mode === "authorized") assertAbsoluteRegularFile(authorityPath, "browser_use_cli_authority_required");
  const normalized = normalizeCommands({ command, commands });
  normalized.forEach((entry) => assertCommandPolicy(entry, mode));
  const normalizedPostCommands = normalizePostCommands(postCommands, mode);
  if (normalizedPostCommands.length > 0 && normalized.length !== 1) {
    throw exactError("browser_use_cli_post_commands_require_one_main_command");
  }
  return Object.freeze({
    automationId: String(automationId),
    runId: String(runId),
    stageId: String(stageId),
    mode,
    lifecycle,
    authorityPath: mode === "authorized" ? path.resolve(String(authorityPath)) : "",
    commands: normalized,
    postCommands: normalizedPostCommands,
  });
}

/**
 * Execute a bounded Browser Use CLI stage.  A scheduled profile is persistent
 * across runs, while every helper invocation still gets a fresh run-scoped
 * download directory and finalized receipt.  The adapter never persists page
 * bodies, cookies, credentials, command values, or helper stdout.
 */
export async function runBrowserUseCliStage({
  automationId,
  runId,
  stageId,
  session = "",
  mode = "authorized",
  lifecycle = "scheduled",
  authorityPath = "",
  allowedOrigins = [],
  command,
  commands,
  postCommands = [],
  artifactDir = "",
  port = null,
  authorityDigest = "",
  expiresAt = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  dryRun = false,
} = {}) {
  if (!dryRun) throw p6RedactedError("browser_use_cli_legacy_stage_requires_flow");
  const request = validateBrowserUseCliStageRequest({ automationId, runId, stageId, mode, lifecycle, authorityPath, command, commands, postCommands });
  const resolvedSession = safeIdentifier(session || `${request.automationId}-${request.stageId}`, "session");
  if (port !== null && (!Number.isSafeInteger(Number(port)) || !(Number(port) >= 19880 && Number(port) <= 19999))) {
    throw exactError("browser_use_cli_port_invalid");
  }
  const allowed = Array.isArray(allowedOrigins) ? allowedOrigins.map((value) => String(value)) : [];
  const resolvedArtifactDir = artifactDir ? path.resolve(String(artifactDir)) : "";
  if (request.postCommands.length > 0) {
    if (!resolvedArtifactDir || !path.isAbsolute(String(artifactDir))) {
      throw exactError("browser_use_cli_post_commands_artifact_dir_required");
    }
    fs.mkdirSync(resolvedArtifactDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(resolvedArtifactDir, 0o700);
    if (fs.realpathSync(resolvedArtifactDir) !== resolvedArtifactDir) {
      throw exactError("browser_use_cli_post_commands_artifact_dir_noncanonical");
    }
    for (const postCommand of request.postCommands) {
      if (postCommand[0] === "screenshot") {
        const screenshotPath = path.resolve(postCommand[1]);
        if (fs.realpathSync(path.dirname(screenshotPath)) !== path.dirname(screenshotPath)) {
          throw exactError("browser_use_cli_post_screenshot_path_noncanonical");
        }
        const relative = path.relative(resolvedArtifactDir, screenshotPath);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw exactError("browser_use_cli_post_screenshot_path_out_of_scope");
        }
      }
    }
  }
  const baseArgs = [
    request.mode,
    "--run-id", request.runId,
    "--session", resolvedSession,
    "--automation-id", request.automationId,
    "--lifecycle", request.lifecycle,
  ];
  if (port !== null) baseArgs.push("--port", String(Number(port)));
  if (request.mode === "authorized") baseArgs.push("--authority", request.authorityPath);
  for (const origin of allowed) baseArgs.push("--allowed-origin", origin);
  if (request.postCommands.length > 0) {
    baseArgs.push("--post-command-json", JSON.stringify(request.postCommands), "--artifact-dir", resolvedArtifactDir);
  }

  const observation = {
    schema: BROWSER_USE_CLI_ADAPTER_SCHEMA,
    browser_surface: BROWSER_USE_CLI_SURFACE,
    automation_id: request.automationId,
    run_id: request.runId,
    stage_id: request.stageId,
    session: resolvedSession,
    lifecycle: request.lifecycle,
    mode: request.mode,
    command_count: request.commands.length,
    commands: request.commands.map(publicCommand),
    external_action_executed: false,
    helper_launched: false,
    cleanup_verified: false,
    status: "blocked",
    exact_blocker: "",
    receipts: [],
    captured_readback: {},
  };

  if (dryRun) {
    observation.status = "dry_run";
    observation.dry_run = true;
    observation.cleanup_verified = true;
    observation.artifact_uri = writeObservation(artifactDir, observation);
    return observation;
  }

  for (const [commandIndex, currentCommand] of request.commands.entries()) {
    observation.helper_launched = true;
    const result = { code: 1, stdout: "", stderr: "", timed_out: false, spawn_error: "browser_use_cli_legacy_target_boundary_disabled" };
    const helper = parseLastJson(result.stdout);
    const receipt = helper?.receipt || "";
    const helperCompleted = result.code === 0 && helper?.status === "completed" && helper?.finalized === true;
    const exactBlocker = helper?.exact_blocker || (helperCompleted
      ? ""
      : result.timed_out
        ? "browser_use_cli_helper_timeout_cleanup_unverified"
        : result.spawn_error || (result.code === 0 ? "browser_use_cli_helper_receipt_missing" : "browser_use_cli_command_failed"));
    if (helper?.captured_readback && typeof helper.captured_readback === "object") {
      observation.captured_readback[String(commandIndex)] = helper.captured_readback;
    }
    observation.receipts.push({
      command: publicCommand(currentCommand),
      status: helper?.status || (result.code === 0 ? "unknown" : "blocked"),
      receipt_path: receipt,
      finalized: helper?.finalized === true,
      exact_blocker: exactBlocker || "",
      exit_status: result.code,
      signal: result.signal || null,
      timed_out: result.timed_out === true,
    });
    if (result.code !== 0 || !helper || helper.finalized !== true || helper.status !== "completed") {
      observation.exact_blocker = exactBlocker;
      observation.cleanup_verified = false;
      observation.status = "blocked";
      break;
    }
  }
  if (!observation.exact_blocker) {
    observation.status = "completed";
    observation.cleanup_verified = observation.receipts.length === request.commands.length
      && observation.receipts.every((entry) => entry.finalized === true && !entry.exact_blocker);
  }
  observation.artifact_uri = writeObservation(artifactDir, observation);
  return observation;
}

function readFlowDescriptor(descriptorPath, { automationId, runId, session, lifecycle, port, contract } = {}) {
  const resolved = path.resolve(String(descriptorPath || ""));
  assertCanonicalPath(resolved, p6RecordingsRoot(), "browser_use_cli_flow_descriptor_path_invalid");
  const descriptor = readJsonFileStrict(resolved, "browser_use_cli_flow_descriptor_invalid");
  if (
    descriptor.schema !== "browser-use-recording.v1"
    || descriptor.status !== "active" && descriptor.status !== "continued"
    || descriptor.automation_id !== automationId
    || descriptor.run_id !== runId
    || descriptor.session !== session
    || descriptor.lifecycle !== lifecycle
    || Number(descriptor.port) !== Number(port)
    || descriptor.owned_chrome !== true
    || !descriptor.process
  ) throw exactError("browser_use_cli_flow_descriptor_binding_invalid");
  if (contract && (descriptor.recorder_active !== true || descriptor.contract?.recorder_active !== true)) throw p6RedactedError("browser_use_cli_recorder_not_active");
  if (lifecycle === "scheduled" && path.resolve(String(descriptor.profile || "")) !== path.join(BROWSER_USE_SCHEDULED_PROFILES_ROOT, automationId)) {
    throw exactError("browser_use_cli_flow_scheduled_profile_binding_invalid");
  }
  if (contract) {
    const descriptorContract = descriptor.contract || descriptor.p6_contract;
    if (!descriptorContract) throw p6RedactedError("browser_use_cli_descriptor_contract_missing");
    assertP6ContractShape(descriptorContract);
    for (const field of ["flow_id", "lease_id", "generation", "automation_id", "run_id", "step_id", "attempt_id", "requested_session", "effective_session", "recorder_active"]) {
      if (String(descriptorContract[field]) !== String(contract[field])) throw p6RedactedError("browser_use_cli_descriptor_contract_mismatch", { field });
    }
  }
  return Object.freeze({
    descriptor_path: resolved,
    run_id: runId,
    session,
    automation_id: automationId,
    lifecycle,
    port: Number(port),
    profile: String(descriptor.profile),
    recording_dir: String(descriptor.recording_dir),
    authority_path: "",
    contract: contract || descriptor.contract || descriptor.p6_contract || null,
    descriptor_state: descriptor.status,
    lease_state: "held",
    operations: Object.freeze(Array.isArray(descriptor.operations) ? [...descriptor.operations] : []),
    navigation_verified: descriptor.navigation_verified === true,
    tab_inventory_path: path.join(String(descriptor.recording_dir), "tab-inventory.json"),
    external_effects: normalizeExternalEffects(descriptor.external_effects, "none"),
    helper_sha256: String(descriptor.helper_sha256 || ""),
    operation_ledger_path: String(descriptor.operation_ledger_path || path.join(String(descriptor.recording_dir), "operation-ledger.jsonl")),
    operation_ledger_tail_digest: String(descriptor.operation_ledger_tail_digest || ""),
  });
}

/**
 * Start one Browser Use CLI flow.  The returned descriptor remains live across
 * related commands; callers must finalize it once the whole user task/run is
 * over, not after each browser step.
 */
export async function startBrowserUseCliFlow({
  automationId,
  runId,
  stageId,
  session = "",
  mode = "authorized",
  lifecycle = "scheduled",
  authorityPath = "",
  allowedOrigins = [],
  command = undefined,
  commands = undefined,
  navigation = undefined,
  targetUrl = undefined,
  contract = {},
  port = null,
  recordingDir = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (command !== undefined || commands !== undefined || navigation !== undefined || targetUrl !== undefined) throw p6RedactedError("browser_use_cli_start_target_command_rejected");
  if (!safeIdentifier(automationId, "automation_id") || !safeIdentifier(runId, "run_id") || !safeIdentifier(stageId, "stage_id")) throw p6RedactedError("browser_use_cli_flow_binding_invalid");
  if (!["authorized", "public"].includes(mode)) throw p6RedactedError("browser_use_cli_mode_invalid");
  if (!["scheduled", "single-use"].includes(lifecycle)) throw p6RedactedError("browser_use_cli_lifecycle_invalid");
  if (mode === "authorized") validateP6AuthorityFile(authorityPath, { automationId, runId, stageId });
  const p6Contract = createBrowserUseCliFlowContract({ automationId, runId, stageId, session, mode, lifecycle, authorityPath, allowedOrigins, descriptorPath: recordingDir ? path.join(path.resolve(recordingDir), "descriptor.json") : "", contract });
  if (mode === "authorized") validateP6AuthorityFile(authorityPath, { automationId, runId, stageId, contract: p6Contract });
  ensureP6LiveWindow(p6Contract);
  assertBrowserUseCliHelperSourceParity();
  const resolvedSession = p6Contract.effective_session;
  if (port !== null && (!Number.isSafeInteger(Number(port)) || !(Number(port) >= 19880 && Number(port) <= 19999))) throw exactError("browser_use_cli_port_invalid");
  const recordingsRoot = p6RecordingsRoot();
  // Browser Harness 0.13.x requires the recording source directory to be a
  // direct child of BROWSER_USE_HOME/recordings.  Keep the run/stage binding
  // in the directory name while preserving that helper-owned layout.
  const defaultRecordingName = `${runId}__${stageId}`;
  const resolvedRecordingDir = validateBrowserUseCliRecordingDir(recordingDir || path.join(recordingsRoot, defaultRecordingName), recordingsRoot);
  fs.mkdirSync(path.dirname(resolvedRecordingDir), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(resolvedRecordingDir), 0o700);
  if (fs.existsSync(resolvedRecordingDir) && fs.readdirSync(resolvedRecordingDir).length > 0) throw exactError("browser_use_cli_flow_recording_dir_not_fresh");
  const args = ["record-start", "--mode", mode, "--run-id", runId, "--session", resolvedSession, "--automation-id", automationId, "--lifecycle", lifecycle, "--recording-dir", resolvedRecordingDir];
  if (mode === "authorized" && lifecycle === "scheduled") args.push("--helper-generation-scope", "owner-lane");
  if (port !== null) args.push("--port", String(Number(port)));
  if (mode === "authorized") args.push("--authority", authorityPath);
  for (const origin of p6Contract.normalized_origins) args.push("--allowed-origin", String(origin));
  const result = await invokeFlowCommand(args, { timeoutMs, phase: "record-start" });
  const parsed = parseHelperResult(result, "recording_ready", "browser_use_cli_flow_start_failed");
  if (parsed.exactBlocker || !parsed.helper?.descriptor) throw p6RedactedError(parsed.exactBlocker || "browser_use_cli_flow_descriptor_missing");
  const descriptorPath = path.resolve(String(parsed.helper.descriptor));
  try {
    const rawDescriptor = readJsonFileStrict(descriptorPath, "browser_use_cli_flow_descriptor_invalid");
    const activeContract = Object.freeze({ ...p6Contract, descriptor: Object.freeze({ ...p6Contract.descriptor, path: descriptorPath, identity: digestValue(descriptorPath) }), descriptor_state: "active", recorder_active: true });
    writePrivateJsonReplace(descriptorPath, { ...rawDescriptor, recorder_active: true, contract: activeContract }, "browser_use_cli_descriptor_contract_write_failed");
    const flow = readFlowDescriptor(descriptorPath, { automationId, runId, session: resolvedSession, lifecycle, port: Number(port), contract: activeContract });
    const tabInventory = readBrowserUseCliFlowTabInventory({ ...flow, contract: activeContract });
    return Object.freeze({ ...flow, contract: activeContract, flow_id: activeContract.flow_id, lease_id: activeContract.lease_id, generation: activeContract.generation, authority_path: authorityPath, allowed_origins: [...activeContract.normalized_origins], tab_inventory: tabInventory, started: true, cleanup_verified: false, transport: parsed.transport || browserUseCliTransportMarker() });
  } catch (error) {
    const cleanupArgs = ["record-finalize", "--run-id", runId, "--session", resolvedSession, "--descriptor", descriptorPath];
    if (mode === "authorized") cleanupArgs.push("--authority", authorityPath);
    try { await spawnHelper(cleanupArgs, { timeoutMs }); } catch (_) { /* preserve the original start blocker */ }
    throw error;
  }
}

function writePrivateJsonReplace(filePath, payload, code) {
  const resolved = path.resolve(String(filePath || ""));
  if (!path.isAbsolute(String(filePath || "")) || resolved !== path.resolve(resolved)) throw exactError(code);
  const parent = path.dirname(resolved);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  fs.chmodSync(parent, 0o700);
  if (fs.realpathSync(parent) !== parent) throw exactError(code);
  const temporary = path.join(parent, `.tmp-${crypto.randomUUID()}`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, resolved);
    fs.chmodSync(resolved, 0o600);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch (_) { /* best effort */ }
  }
  return resolved;
}

function readFlowLease(leasePath, { status = "held" } = {}) {
  const resolved = path.resolve(String(leasePath || ""));
  if (!path.isAbsolute(String(leasePath || "")) || resolved !== path.resolve(resolved)) throw exactError("browser_use_cli_flow_lease_path_invalid");
  assertOwnerMode(resolved, 0o600, "browser_use_cli_flow_lease_invalid");
  let lease;
  try { lease = JSON.parse(fs.readFileSync(resolved, "utf8")); } catch { throw exactError("browser_use_cli_flow_lease_invalid"); }
  if (status && String(lease?.status || "") !== status) throw p6RedactedError("browser_use_cli_flow_lease_status_invalid");
  validateBrowserUseCliFlowLease(lease);
  if (!safeIdentifier(lease.contract.automation_id, "flow_lease_automation_id") || !safeIdentifier(lease.contract.run_id, "flow_lease_run_id") || !safeIdentifier(lease.contract.effective_session, "flow_lease_session") || !["scheduled", "single-use"].includes(String(lease.lifecycle || "scheduled")) || !Number.isSafeInteger(Number(lease.port)) || !String(lease.descriptor_path || "") || !String(lease.profile || "")) throw p6RedactedError("browser_use_cli_flow_lease_binding_invalid");
  const descriptorPath = assertCanonicalPath(lease.descriptor_path, p6RecordingsRoot(), "browser_use_cli_flow_lease_descriptor_invalid");
  const profileRoot = lease.lifecycle === "scheduled" ? BROWSER_USE_SCHEDULED_PROFILES_ROOT : BROWSER_USE_SINGLE_USE_PROFILES_ROOT;
  const profile = assertCanonicalPath(lease.profile, profileRoot, "browser_use_cli_flow_lease_profile_invalid");
  if (lease.lifecycle === "scheduled" && profile !== path.join(BROWSER_USE_SCHEDULED_PROFILES_ROOT, lease.automation_id)) throw exactError("browser_use_cli_flow_lease_scheduled_profile_binding_invalid");
  return Object.freeze({
    ...lease,
    lease_path: resolved,
    descriptor_path: descriptorPath,
    profile,
    port: Number(lease.port),
    authority_path: String(lease.authority_path || lease.contract.authority.reference || ""),
    allowed_origins: Array.isArray(lease.allowed_origins) ? [...lease.allowed_origins] : [...lease.contract.normalized_origins],
  });
}

/**
 * Persist a run/task-owned lease without closing the Browser Use session.
 * The lease is deliberately metadata-only: it contains paths and bindings,
 * never credentials or page contents.  The owner must call the finalizer at
 * the end of the whole task/run.
 */
export function writeBrowserUseCliFlowLease({ flow, leasePath, authorityPath = "", scope = "task" } = {}) {
  if (!flow?.descriptor_path || !flow?.contract) throw p6RedactedError("browser_use_cli_flow_lease_flow_required");
  const contract = validateBrowserUseCliFlowBinding(flow);
  const descriptor = readFlowDescriptor(flow.descriptor_path, {
    automationId: flow.automation_id,
    runId: flow.run_id,
    session: flow.session,
    lifecycle: flow.lifecycle,
    port: flow.port,
    contract,
  });
  const resolvedLeasePath = path.resolve(String(leasePath || ""));
  if (!path.isAbsolute(String(leasePath || "")) || resolvedLeasePath !== path.resolve(resolvedLeasePath)) throw exactError("browser_use_cli_flow_lease_path_invalid");
  const lease = {
    schema: BROWSER_USE_CLI_FLOW_LEASE_SCHEMA,
    status: "held",
    scope: String(scope || "task"),
    flow_id: contract.flow_id,
    lease_id: contract.lease_id,
    generation: contract.generation,
    owner: { workflow_id: contract.workflow.id, automation_id: contract.automation_id, run_id: contract.run_id, step_id: contract.step_id, attempt_id: contract.attempt_id },
    session_binding: { requested: contract.requested_session, effective: contract.effective_session },
    authority_digest: contract.authority.sha256,
    origin_digest: contract.normalized_origin_digest,
    adapter_sha256: contract.adapter_sha256,
    runtime_digest: contract.runtime.home_digest,
    action_sequence: contract.action_sequence,
    not_before: contract.not_before,
    expires_at: contract.expires_at,
    contract,
    run_id: contract.run_id,
    automation_id: contract.automation_id,
    session: contract.effective_session,
    lifecycle: flow.lifecycle,
    port: Number(flow.port),
    profile: descriptor.profile,
    descriptor_path: descriptor.descriptor_path,
    recording_dir: descriptor.recording_dir,
    authority_path: String(authorityPath || flow.authority_path || contract.authority.reference || ""),
    allowed_origins: [...contract.normalized_origins],
    process: descriptor.process,
    acquired_at: contract.created_at,
    updated_at: new Date().toISOString(),
  };
  validateBrowserUseCliFlowLease(lease);
  writePrivateJsonReplace(resolvedLeasePath, lease, "browser_use_cli_flow_lease_write_failed");
  return Object.freeze({ ...lease, lease_path: resolvedLeasePath });
}

export function validateBrowserUseCliRecordingDir(recordingDir, recordingsRoot = BROWSER_USE_RECORDINGS_ROOT) {
  const root = path.resolve(String(recordingsRoot || ""));
  const resolved = path.resolve(String(recordingDir || ""));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw exactError("browser_use_cli_flow_recording_dir_invalid");
  if (path.dirname(resolved) !== root) throw exactError("browser_use_recording_dir_not_harness_scoped");
  return resolved;
}

export function resumeBrowserUseCliFlowFromLease({ leasePath } = {}) {
  const lease = readFlowLease(leasePath, { status: "held" });
  const flow = readFlowDescriptor(lease.descriptor_path, {
    automationId: lease.contract.automation_id,
    runId: lease.contract.run_id,
    session: lease.contract.effective_session,
    lifecycle: lease.lifecycle,
    port: lease.port,
    contract: lease.contract,
  });
  const activeContract = Object.freeze({ ...lease.contract, descriptor: Object.freeze({ ...lease.contract.descriptor, path: flow.descriptor_path, identity: digestValue(flow.descriptor_path) }), descriptor_state: "active", recorder_active: true });
  return Object.freeze({
    ...flow,
    contract: activeContract,
    flow_id: activeContract.flow_id,
    lease_id: activeContract.lease_id,
    generation: activeContract.generation,
    authority_path: lease.authority_path,
    allowed_origins: [...activeContract.normalized_origins],
    lease_path: lease.lease_path,
    lease: Object.freeze(lease),
    resumed: true,
    cleanup_verified: false,
  });
}

export async function finalizeBrowserUseCliFlowLease({ leasePath, authorityPath = "", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const lease = readFlowLease(leasePath, { status: "held" });
  const flow = resumeBrowserUseCliFlowFromLease({ leasePath: lease.lease_path });
  const finalized = await finalizeBrowserUseCliFlow({
    flow,
    authorityPath: authorityPath || lease.authority_path,
    timeoutMs,
  });
  const updated = {
    ...lease,
    status: "finalized",
    updated_at: new Date().toISOString(),
    receipt_path: finalized.receipt_path,
    manifest_path: finalized.manifest_path,
    cleanup_status: finalized.cleanup_status,
    finalized: true,
  };
  writePrivateJsonReplace(lease.lease_path, updated, "browser_use_cli_flow_lease_finalize_write_failed");
  return Object.freeze({ ...finalized, lease_path: lease.lease_path, flow_lease_status: "finalized" });
}

export async function runBrowserUseCliFlowCommand({ flow, authorityPath = "", command, actionSequence = 0, actionNonce = "", captureReadback = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!flow?.descriptor_path || !flow?.contract) throw p6RedactedError("browser_use_cli_flow_descriptor_required");
  const contract = validateBrowserUseCliFlowBinding(flow, { authoritySha256: flow.contract.authority?.sha256 });
  if (contract.authorized_scheduled_flow !== true || contract.mode !== "authorized" || contract.lifecycle !== "scheduled") throw p6RedactedError("browser_use_cli_authorized_scheduled_flow_required");
  assertBrowserUseCliHelperSourceParity();
  if (authorityPath && flow.authority_path && path.resolve(String(authorityPath)) !== path.resolve(String(flow.authority_path))) throw p6RedactedError("browser_use_cli_authority_mismatch");
  validateP6AuthorityFile(authorityPath || contract.authority.reference, { automationId: contract.automation_id, runId: contract.run_id, stageId: contract.step_id, contract });
  const request = validateBrowserUseCliStageRequest({ automationId: contract.automation_id, runId: contract.run_id, stageId: contract.step_id, session: contract.effective_session, mode: "authorized", lifecycle: "scheduled", authorityPath: authorityPath || contract.authority.reference, allowedOrigins: contract.normalized_origins, command, postCommands: [] });
  const action = validateP6Action(request.commands[0], contract, { actionSequence, actionNonce });
  if (captureReadback && !(request.commands[0][0] === "state"
    || (request.commands[0][0] === "get" && ["url", "title"].includes(request.commands[0][1]))
    || (request.commands[0][0] === "eval" && ["location.href", "document.title", READ_ONLY_LINK_EVAL, READ_ONLY_APPLICATION_LINK_EVAL, READ_ONLY_JOB_DETAIL_EVAL, READ_ONLY_SOCIAL_LINK_EVAL, READ_ONLY_SOCIAL_CARD_EVAL, READ_ONLY_SOCIAL_FEED_CARD_EVAL, READ_ONLY_SOCIAL_CARD_CONTAINER_EVAL].includes(request.commands[0][1])))) throw p6RedactedError("browser_use_cli_flow_capture_command_not_allowlisted");
  const admitted = readFlowDescriptor(flow.descriptor_path, { automationId: contract.automation_id, runId: contract.run_id, session: contract.effective_session, lifecycle: contract.lifecycle, port: flow.port, contract });
  const normalizedCommand = request.commands[0];
  const currentHelperDigest = sha256File(BROWSER_USE_CLI_HELPER);
  const helperMismatch = Boolean(admitted.helper_sha256) && admitted.helper_sha256 !== currentHelperDigest;
  const navigationCommand = ["open", "back", "switch"].includes(normalizedCommand[0]);
  const readOnlyRefreshable = HELPER_REFRESH_READ_ONLY_COMMANDS.has(normalizedCommand[0]);
  let helperRefreshed = false;
  if (helperMismatch && !readOnlyRefreshable) {
    if (navigationCommand) {
      const recoveryArgs = ["record-command", "--run-id", contract.run_id, "--session", contract.effective_session, "--descriptor", flow.descriptor_path, "--refresh-helper"];
      if (contract.authority.mode === "authorized") recoveryArgs.push("--authority", authorityPath || contract.authority.reference, "--auto-renew");
      recoveryArgs.push("--", "state");
      const refreshResult = await invokeFlowCommand(recoveryArgs, { timeoutMs: RECOVERY_TIMEOUT_MS, phase: "refresh-helper" });
      const refreshParsed = parseHelperResult(refreshResult, "recording_continued", "browser_use_cli_helper_refresh_failed");
      if (refreshParsed.exactBlocker || !refreshParsed.helper) {
        throw p6RedactedError(refreshParsed.exactBlocker || "browser_use_cli_helper_refresh_failed", { helper_refresh: true });
      }
      helperRefreshed = true;
      throw p6RedactedError("browser_use_cli_helper_refreshed_navigation_readback_required", {
        helper_refresh: true,
        navigation_readback_required: true,
      });
    }
    throw p6RedactedError("browser_use_cli_helper_hash_mismatch", { helper_refresh: false });
  }
  const args = ["record-command", "--run-id", contract.run_id, "--session", contract.effective_session, "--descriptor", flow.descriptor_path];
  if (contract.authority.mode === "authorized") args.push("--authority", authorityPath || contract.authority.reference, "--auto-renew");
  if (captureReadback) args.push("--capture-readback");
  if (helperMismatch && readOnlyRefreshable) {
    args.push("--refresh-helper");
    helperRefreshed = true;
  }
  args.push("--", ...normalizedCommand);
  const result = await invokeFlowCommand(args, { timeoutMs });
  if (result.timed_out) {
    let recovery;
    try {
      recovery = await recoverFlowAfterTransportTimeout({ flow, authorityPath, timeoutMs: RECOVERY_TIMEOUT_MS });
    } catch (error) {
      recovery = { status: "blocked", exactBlocker: error?.exact_blocker || "browser_use_cli_flow_recovery_failed", childExited: false };
    }
    throw p6RedactedError(
      recovery.exactBlocker ? "browser_use_cli_transport_timeout_recovery_failed" : "browser_use_cli_transport_timeout_recovered",
      {
        transport_timeout: true,
        helper_child_exited: result.child_exited !== false,
        recovery_status: recovery.status,
        recovery_blocker: recovery.exactBlocker || "",
        restart_point: "same-run read-only readback required before replay",
      },
    );
  }
  const parsed = parseHelperResult(result, "recording_continued", "browser_use_cli_flow_command_failed");
  if (parsed.exactBlocker || !parsed.helper) {
    throw p6RedactedError(parsed.exactBlocker || "browser_use_cli_flow_command_failed", {
      helper_status: parsed.helper?.status || "",
      helper_exact_blocker: parsed.helper?.exact_blocker || "",
      exit_code: result.code,
      timed_out: result.timed_out === true,
    });
  }
  const renewedContract = flowContractAfterAuthorityRenewal(contract, parsed.helper);
  const current = readFlowDescriptor(flow.descriptor_path, { automationId: renewedContract.automation_id, runId: renewedContract.run_id, session: renewedContract.effective_session, lifecycle: renewedContract.lifecycle, port: flow.port, contract: renewedContract });
  const tabInventory = readBrowserUseCliFlowTabInventory({ ...flow, ...current, contract: renewedContract });
  const effectfulCommand = !["state", "get", "screenshot", "extract", "wait", "scroll", "back", "close-tab"].includes(request.commands[0][0]);
  const externalEffects = normalizeExternalEffects(parsed.helper?.external_effects, effectfulCommand ? "unknown" : "none");
  const nextContract = Object.freeze({ ...renewedContract, action_sequence: action.sequence, last_action_nonce: action.nonce, descriptor_state: "continued", recorder_active: true });
  return Object.freeze({
    ...flow,
    ...current,
    contract: nextContract,
    tab_inventory: tabInventory,
    command: Object.freeze({ name: request.commands[0][0], argument_count: Math.max(0, request.commands[0].length - 1), origins: publicCommand(request.commands[0]).origins }),
    captured_readback: normalizeBrowserUseCliCapturedReadback(parsed.helper.captured_readback || {}),
    command_completed: true,
    external_effects: externalEffects,
    business_effect_proof: parsed.helper?.business_effect_proof || (effectfulCommand ? "workflow_source_of_truth_required" : "not_applicable"),
    external_action_executed: externalEffects === "executed",
    helper_refreshed: helperRefreshed,
    authority_path: nextContract.authority.reference,
    transport: parsed.transport || "helper",
    result_schema: "browser_use_cli_bounded_command_result.v1",
  });
}

export async function runBrowserUseCliFlowReadOnlyBatch({
  flow,
  authorityPath = "",
  commands = [],
  actionSequence = 0,
  actionNonces = [],
  captureReadback = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!flow?.descriptor_path || !flow?.contract) throw p6RedactedError("browser_use_cli_flow_descriptor_required");
  const contract = validateBrowserUseCliFlowBinding(flow, { authoritySha256: flow.contract.authority?.sha256 });
  if (contract.authorized_scheduled_flow !== true || contract.mode !== "authorized" || contract.lifecycle !== "scheduled") {
    throw p6RedactedError("browser_use_cli_authorized_scheduled_flow_required");
  }
  assertBrowserUseCliHelperSourceParity();
  if (authorityPath && flow.authority_path && path.resolve(String(authorityPath)) !== path.resolve(String(flow.authority_path))) {
    throw p6RedactedError("browser_use_cli_authority_mismatch");
  }
  const authority = authorityPath || contract.authority.reference;
  validateP6AuthorityFile(authority, { automationId: contract.automation_id, runId: contract.run_id, stageId: contract.step_id, contract });
  const request = validateBrowserUseCliStageRequest({
    automationId: contract.automation_id,
    runId: contract.run_id,
    stageId: contract.step_id,
    session: contract.effective_session,
    mode: "authorized",
    lifecycle: "scheduled",
    authorityPath: authority,
    allowedOrigins: contract.normalized_origins,
    commands,
    postCommands: [],
  });
  const normalizedCommands = validateBrowserUseCliReadOnlyBatchCommands(request.commands);
  const baseSequence = Math.max(Number(contract.action_sequence), Number(actionSequence) || 0);
  const suppliedNonces = Array.isArray(actionNonces) ? actionNonces : [];
  const batchActions = [];
  const seenNonces = new Set();
  for (const [index, command] of normalizedCommands.entries()) {
    const sequence = baseSequence + index + 1;
    const nonce = String(suppliedNonces[index] || createBrowserUseCliActionNonce({
      runId: contract.run_id,
      actionSequence: sequence,
      salt: `readonly-batch-${index}`,
    }));
    if (seenNonces.has(nonce)) throw p6RedactedError("browser_use_cli_read_only_batch_nonce_replay");
    seenNonces.add(nonce);
    const action = validateP6Action(command, contract, { actionSequence: sequence, actionNonce: nonce });
    batchActions.push(Object.freeze({
      sequence: action.sequence,
      nonce: action.nonce,
      name: command[0],
      argument_count: Math.max(0, command.length - 1),
      origins: publicCommand(command).origins,
    }));
  }
  const args = [
    "record-batch",
    "--run-id", contract.run_id,
    "--session", contract.effective_session,
    "--descriptor", flow.descriptor_path,
    "--authority", authority,
    "--auto-renew",
    "--commands-json", JSON.stringify(normalizedCommands),
    "--batch-actions-json", JSON.stringify(batchActions),
  ];
  if (captureReadback) args.push("--capture-readback");
  const result = await invokeFlowCommand(args, { timeoutMs, phase: "record-batch" });
  if (result.timed_out) {
    let recovery;
    try {
      recovery = await recoverFlowAfterTransportTimeout({ flow, authorityPath: authority, timeoutMs: RECOVERY_TIMEOUT_MS });
    } catch (error) {
      recovery = { status: "blocked", exactBlocker: error?.exact_blocker || "browser_use_cli_flow_recovery_failed", childExited: false };
    }
    throw p6RedactedError(
      recovery.exactBlocker ? "browser_use_cli_transport_timeout_recovery_failed" : "browser_use_cli_transport_timeout_recovered",
      {
        transport_timeout: true,
        helper_child_exited: result.child_exited !== false,
        recovery_status: recovery.status,
        recovery_blocker: recovery.exactBlocker || "",
        restart_point: "same-run read-only batch reconciliation required before replay",
      },
    );
  }
  const parsed = parseHelperResult(result, "recording_continued", "browser_use_cli_flow_read_only_batch_failed");
  const helper = parsed.helper;
  const results = Array.isArray(helper?.results) ? helper.results : [];
  const completedCount = Number(helper?.completed_count);
  const batchValid = helper?.batch === true
    && helper?.external_effects === "none"
    && completedCount === normalizedCommands.length
    && results.length === normalizedCommands.length
    && results.every((entry) => entry && entry.status === "recording_continued" && String(entry.external_effects || "none") === "none");
  if (parsed.exactBlocker || !helper || !batchValid) {
    throw p6RedactedError(parsed.exactBlocker || "browser_use_cli_read_only_batch_result_invalid", {
      helper_status: helper?.status || "",
      helper_batch: helper?.batch === true,
      helper_external_effects: helper?.external_effects || "",
      command_count: normalizedCommands.length,
      completed_count: Number.isFinite(completedCount) ? completedCount : -1,
    });
  }
  const renewedContract = flowContractAfterAuthorityRenewal(contract, helper);
  const current = readFlowDescriptor(flow.descriptor_path, {
    automationId: renewedContract.automation_id,
    runId: renewedContract.run_id,
    session: renewedContract.effective_session,
    lifecycle: renewedContract.lifecycle,
    port: flow.port,
    contract: renewedContract,
  });
  const tabInventory = readBrowserUseCliFlowTabInventory({ ...flow, ...current, contract: renewedContract });
  const lastAction = batchActions.at(-1);
  const nextContract = Object.freeze({
    ...renewedContract,
    action_sequence: lastAction.sequence,
    last_action_nonce: lastAction.nonce,
    descriptor_state: "continued",
    recorder_active: true,
  });
  return Object.freeze({
    ...flow,
    ...current,
    contract: nextContract,
    tab_inventory: tabInventory,
    batch: true,
    batch_actions: Object.freeze(batchActions),
    batch_results: redactBrowserUseCliResult(results),
    captured_readback: normalizeBrowserUseCliCapturedReadback(helper.captured_readback || {}),
    command_completed: true,
    external_effects: "none",
    business_effect_proof: "not_applicable",
    external_action_executed: false,
    authority_path: nextContract.authority.reference,
    transport: parsed.transport || "helper",
    result_schema: "browser_use_cli_bounded_read_only_batch_result.v1",
  });
}

async function runBrowserUseCliFlowTargetOperation({ flow, authorityPath = "", targetText = "", operation, actionSequence = 0, actionNonce = "", timeoutMs = DEFAULT_TIMEOUT_MS, allowCoordinateFallback = false } = {}) {
  if (!flow?.descriptor_path || !flow?.contract) throw p6RedactedError("browser_use_cli_flow_descriptor_required");
  const target = boundedString(targetText, 240).trim();
  if (!target) throw p6RedactedError("browser_use_cli_target_text_missing");
  const contract = validateBrowserUseCliFlowBinding(flow, { authoritySha256: flow.contract.authority?.sha256 });
  if (contract.authorized_scheduled_flow !== true || contract.mode !== "authorized" || contract.lifecycle !== "scheduled") throw p6RedactedError("browser_use_cli_authorized_scheduled_flow_required");
  assertBrowserUseCliHelperSourceParity();
  if (authorityPath && flow.authority_path && path.resolve(String(authorityPath)) !== path.resolve(String(flow.authority_path))) throw p6RedactedError("browser_use_cli_authority_mismatch");
  const sequenceAction = operation === "target-click" ? ["click", target] : ["state"];
  const action = validateP6Action(sequenceAction, contract, { actionSequence, actionNonce });
  const admitted = readFlowDescriptor(flow.descriptor_path, { automationId: contract.automation_id, runId: contract.run_id, session: contract.effective_session, lifecycle: contract.lifecycle, port: flow.port, contract });
  if (admitted.navigation_verified !== true) throw exactError("browser_use_cli_navigation_readback_required_before_target");
  const args = [operation === "target-click" ? "record-target-click" : "record-target-inspect", "--run-id", contract.run_id, "--session", contract.effective_session, "--descriptor", flow.descriptor_path, ...(authorityPath || flow.authority_path ? ["--authority", authorityPath || flow.authority_path, "--auto-renew"] : []), "--target-text", target];
  if (operation === "target-click" && allowCoordinateFallback === true) args.push("--allow-coordinate-fallback");
  const result = await invokeFlowCommand(args, { timeoutMs });
  const parsed = parseHelperResult(result, "recording_continued", "browser_use_cli_flow_target_operation_failed");
  if (parsed.exactBlocker || !parsed.helper) throw p6RedactedError(parsed.exactBlocker || "browser_use_cli_flow_target_operation_failed");
  const renewedContract = flowContractAfterAuthorityRenewal(contract, parsed.helper);
  const current = readFlowDescriptor(flow.descriptor_path, { automationId: renewedContract.automation_id, runId: renewedContract.run_id, session: renewedContract.effective_session, lifecycle: renewedContract.lifecycle, port: flow.port, contract: renewedContract });
  const tabInventory = readBrowserUseCliFlowTabInventory({ ...flow, ...current, contract: renewedContract });
  const externalEffects = normalizeExternalEffects(parsed.helper?.external_effects, operation === "target-click" ? "unknown" : "none");
  const nextContract = Object.freeze({ ...renewedContract, action_sequence: action.sequence, last_action_nonce: action.nonce, descriptor_state: "continued", recorder_active: true });
  const safeHelper = redactBrowserUseCliResult(parsed.helper);
  return Object.freeze({
    ...flow,
    ...current,
    contract: nextContract,
    tab_inventory: tabInventory,
    target_operation: operation,
    target_text_sha256: digestValue(target),
    target_result: safeHelper,
    command_completed: true,
    external_effects: externalEffects,
    business_effect_proof: parsed.helper?.business_effect_proof || (operation === "target-click" ? "workflow_source_of_truth_required" : "not_applicable"),
    external_action_executed: externalEffects === "executed",
    authority_path: nextContract.authority.reference,
    result_schema: "browser_use_cli_bounded_target_result.v1",
  });
}

export async function runBrowserUseCliFlowTargetInspect({ flow, authorityPath = "", targetText = "", actionSequence = 0, actionNonce = "", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return runBrowserUseCliFlowTargetOperation({ flow, authorityPath, targetText, operation: "target-inspect", actionSequence, actionNonce, timeoutMs });
}

export async function runBrowserUseCliFlowTargetClick({ flow, authorityPath = "", targetText = "", actionSequence = 0, actionNonce = "", timeoutMs = DEFAULT_TIMEOUT_MS, allowCoordinateFallback = false } = {}) {
  return runBrowserUseCliFlowTargetOperation({ flow, authorityPath, targetText, operation: "target-click", actionSequence, actionNonce, timeoutMs, allowCoordinateFallback });
}

export async function finalizeBrowserUseCliFlow({ flow, authorityPath = "", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!flow?.descriptor_path || !flow?.contract) throw p6RedactedError("browser_use_cli_flow_descriptor_required");
  const contract = validateBrowserUseCliFlowBinding(flow);
  if (authorityPath && flow.authority_path && path.resolve(String(authorityPath)) !== path.resolve(String(flow.authority_path))) throw p6RedactedError("browser_use_cli_authority_mismatch");
  const args = ["record-finalize", "--run-id", contract.run_id, "--session", contract.effective_session, "--descriptor", flow.descriptor_path];
  if (authorityPath) args.push("--authority", authorityPath);
  const result = await spawnHelper(args, { timeoutMs });
  const parsed = parseHelperResult(result, "completed", "browser_use_cli_flow_finalize_failed", { allowFinalized: true });
  const receiptPath = String(parsed.helper?.receipt || "");
  if (parsed.exactBlocker || !receiptPath) throw exactError(parsed.exactBlocker || "browser_use_cli_flow_receipt_missing");
  const receipt = readJsonFileStrict(receiptPath, "browser_use_cli_flow_receipt_invalid");
  const descriptor = readJsonFileStrict(flow.descriptor_path, "browser_use_cli_flow_descriptor_invalid");
  const manifestPath = String(parsed.helper?.manifest || descriptor.manifest_path || "");
  const manifest = manifestPath ? readJsonFileStrict(manifestPath, "browser_use_cli_flow_manifest_invalid") : {};
  const video = parsed.helper?.video || descriptor.video || manifest.video || {};
  const evidence = {
    ...receipt,
    business_effect_proof: receipt.business_effect_proof ?? manifest.business_effect_proof ?? parsed.helper?.business_effect_proof ?? "not_applicable",
    external_effects: normalizeExternalEffects(receipt.external_effects ?? manifest.external_effects ?? parsed.helper?.external_effects, "unknown"),
    ffprobe: receipt.ffprobe || {
      codec: video.codec,
      duration_seconds: video.duration_seconds,
      positive_frame_count: video.frames,
    },
    mp4_path: receipt.mp4_path || video.video_path,
    manifest_path: receipt.manifest_path || manifestPath,
    mp4_sha256: receipt.mp4_sha256 || video.sha256,
    manifest_sha256: receipt.manifest_sha256 || (manifestPath ? sha256File(manifestPath) : ""),
    graceful_session_close: receipt.graceful_session_close ?? (receipt.finalized === true && receipt.exit?.code === 0),
    cleanup: {
      ...(receipt.cleanup || {}),
      sessions_closed: receipt.cleanup?.sessions_closed ?? (receipt.finalized === true && receipt.exit?.code === 0),
      pid_verified: receipt.cleanup?.pid_verified ?? (receipt.guard_readback?.process_identity_verified === true),
      loopback_listener_closed: receipt.cleanup?.loopback_listener_closed ?? (receipt.finalized === true && receipt.exit?.code === 0),
      profile_cleanup: receipt.cleanup?.profile_cleanup ?? Boolean(receipt.cleanup?.status),
      lock_cleanup: receipt.cleanup?.lock_cleanup ?? Array.isArray(receipt.cleanup?.locks_removed),
      unknown_processes: receipt.cleanup?.unknown_processes || [],
    },
  };
  evidence.cleanup_proof = buildBrowserUseCliCleanupProof(evidence, {
    descriptorPath: flow.descriptor_path,
    receiptPath,
  });
  validateBrowserUseCliFinalizeAcceptance(evidence);
  validateBrowserUseCliFinalizeCleanup(evidence, flow.lifecycle);
  const cleanupStatus = String(evidence.cleanup?.status || "");
  const finalizedContract = Object.freeze({ ...contract, descriptor_state: "finalized", recorder_active: false, lease_state: "finalized" });
  return Object.freeze({ ...flow, contract: finalizedContract, finalized: true, cleanup_verified: true, cleanup_proof: evidence.cleanup_proof, receipt_path: receiptPath, manifest_path: boundedString(String(parsed.helper?.manifest || "")), cleanup_status: cleanupStatus, external_effects: evidence.external_effects, business_effect_proof: evidence.business_effect_proof, external_action_executed: evidence.external_effects === "executed", result_schema: "browser_use_cli_bounded_finalize_result.v1" });
}

export function validateBrowserUseCliFinalizeCleanup(receipt = {}, lifecycle = "single-use") {
  const cleanupStatus = String(receipt.cleanup?.status || "");
  const cleanupVerified = receipt.finalized === true
    && (lifecycle === "scheduled" ? cleanupStatus === "scheduled_profile_preserved" : cleanupStatus === "cleaned")
    && receipt.cleanup?.download_dir_removed === true
    && Array.isArray(receipt.cleanup?.locks_removed);
  if (!cleanupVerified) throw exactError("browser_use_cli_flow_cleanup_readback_failed");
  return true;
}

export function validateBrowserUseCliFinalizeAcceptance(receipt = {}) {
  const externalEffects = String(receipt.external_effects ?? "none");
  if (!EXTERNAL_EFFECT_STATES.has(externalEffects) || externalEffects === "unknown") throw p6RedactedError("browser_use_cli_external_effects_unresolved");
  const ffprobe = receipt.ffprobe || {};
  if (!ffprobe.codec || !Number.isFinite(Number(ffprobe.duration_seconds)) || Number(ffprobe.duration_seconds) <= 0 || !Number.isSafeInteger(Number(ffprobe.positive_frame_count)) || Number(ffprobe.positive_frame_count) <= 0) throw p6RedactedError("browser_use_cli_ffprobe_acceptance_failed");
  for (const field of ["mp4_sha256", "manifest_sha256"]) if (!/^[a-f0-9]{64}$/u.test(String(receipt[field] || ""))) throw p6RedactedError("browser_use_cli_artifact_hash_invalid");
  if (receipt.graceful_session_close !== true) throw p6RedactedError("browser_use_cli_graceful_close_unverified");
  const cleanup = receipt.cleanup || {};
  if (cleanup.sessions_closed !== true || cleanup.pid_verified !== true || cleanup.loopback_listener_closed !== true || cleanup.profile_cleanup !== true || cleanup.lock_cleanup !== true || !Array.isArray(cleanup.locks_removed)) throw p6RedactedError("browser_use_cli_cleanup_readback_failed");
  if (!Array.isArray(cleanup.unknown_processes)) throw p6RedactedError("browser_use_cli_unknown_process_cleanup_unresolved");
  if (cleanup.unknown_processes.length > 0) throw p6RedactedError("browser_use_cli_unknown_process_cleanup_unresolved");
  const mp4Path = assertAbsoluteRegularFile(receipt.mp4_path, "browser_use_cli_mp4_path_invalid");
  const manifestPath = assertAbsoluteRegularFile(receipt.manifest_path, "browser_use_cli_manifest_path_invalid");
  if (sha256File(mp4Path) !== String(receipt.mp4_sha256)) throw p6RedactedError("browser_use_cli_mp4_digest_mismatch");
  if (sha256File(manifestPath) !== String(receipt.manifest_sha256)) throw p6RedactedError("browser_use_cli_manifest_digest_mismatch");
  return true;
}
