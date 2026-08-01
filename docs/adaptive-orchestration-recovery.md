# Portable Adaptive Orchestration recovery after PC loss

This document is self-contained and covers only the Adaptive Orchestration surface.
It does not depend on a machine-local policy file or any chat/session history.

Use this bounded recovery sequence after cloning the repository onto the replacement machine.

1. Clone the repository and enter the checkout:

   ```sh
   git clone <repository-url>
   cd <repository-directory>
   ```

2. Verify Python and `uv`, then install the project dependencies:

   ```sh
   python3 --version
   uv --version
   uv sync
   ```

3. Run the focused routing and dispatch tests:

   ```sh
   uv run pytest -q tests/test_codex_architecture_mode.py tests/test_codex_model_dispatch.py tests/test_adaptive_route_policy.py tests/test_adaptive_orchestration_runtime.py tests/test_adaptive_session_audit.py
   ```

4. Perform the current runtime's live capability and model preflight. Make the
   restore-time role and model selection after live preflight, using only the
   capabilities that are live at that point; do not copy a prior selection into
   the recovery record. For the STANDARD reviewer, the preferred OpenCode Go
   order is `opencode-go/deepseek-v4-pro`,
   `opencode-go/mimo-v2.5-pro`, then `opencode-go/deepseek-v4-flash`, but this
   is only a candidate order. Require the selected direct MCP route to report
   verified provider/model, supported bridge version, request ID, usage, and
   bounded output.

5. Validate only a sanitized JSON summary, if one is supplied for recovery:

   ```sh
   python3 -m json.tool path/to/sanitized-summary.json >/dev/null
   ```

   The summary must contain only non-sensitive status, schema, and check results.
   Do not add raw canary or all-session audit readbacks when they contain IDs or
   internal runtime details; replace them with this sanitized summary instead.

6. Confirm the repository role files listed by
   `docs/adaptive-orchestration-manifest.v1.json` exist: `architect.toml`,
   `reviewer.toml`, `critical_architect.toml`, `critical_reviewer.toml`, and
   the configured worker role files under `.codex/agents/`.

   Role and model selection is made at restore time from current live capability,
   preflight, and environment. The role files are candidate runtime contracts,
   not a mandate to use a model that is unavailable at restore time. Any
   fallback must remain bounded and same-role. OpenCode Go provider, auth,
   bridge, schema, task, malformed-output, and missing-route failures do not
   fall back to native Codex or another provider.

7. Keep session audits bounded. Use `social_flow.adaptive_session_audit` for
   local `session_index.jsonl` and explicitly named rollout evidence; enforce
   byte, record, and elapsed-time limits and treat `session_audit_timeout:*` as
   an audit blocker. Do not use a broad live App thread list as the only
   recovery source, and do not mark a child successful when its task prompt or
   final response is missing (`child_task_prompt_missing` /
   `child_task_final_missing`).

8. For an evidence-only cross-session audit, keep the audit on the Direct root
   lane instead of creating an Executor stage solely for session collection.
   When using the official App tools, obtain a fresh `list_threads` result and
   read each candidate with minimal `threadId` plus its fresh host. If the
   explicit-host read fails, retry once hostless or with a newly returned host;
   record `thread_readback_host_binding`, and preserve the exact blocker if both
   attempts fail. A list result alone is discovery evidence, not thread proof.

Machine-local Codex App state and global Codex configuration are not stored in this
repository. Re-establish that machine-local configuration separately; do not copy
secrets, credentials, personal data, session/thread/host identifiers, or absolute local paths
into the repository or this recovery document. Raw work artifacts and
unrelated lane state are not part of Adaptive recovery; use the manifest allowlist
and exclusions as the boundary.
