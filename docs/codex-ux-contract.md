# Codex UX Contract

This workspace keeps Codex usable by treating the harness, not the model alone, as the product.

## Principle

- Use Codex-approved native models for task execution and direct OpenCode Go MCP only for the STANDARD reviewer.
- Keep the current starting parent model as the BASE executor.
- Reserve the strong Sol lane for harder analysis and final checks.
- Put planning, memory, review gates, and safety gates in durable workspace files instead of relying on chat history.

## Architecture mode

- Treat this repository as the Codex-native version of the architect-as-orchestrator pattern from `fable-advisor`.
- Keep the starting parent dynamic: `auto` native-bypasses 5.6-family starts; verified `gpt-5.3-codex-spark` / `gpt-5.4` / `gpt-5.4-mini` / `gpt-5.5` starts use separate statically model-pinned worker roles, while hidden/internal and unknown starts remain native OFF.
- Use `gpt-5.6-sol / max` as the STANDARD commander. The independent STANDARD reviewer is selected at runtime from live OpenCode Go capability, preferring `opencode-go/deepseek-v4-pro`, then `opencode-go/mimo-v2.5-pro`, then `opencode-go/deepseek-v4-flash`.
- Use the same `gpt-5.6-sol / max` with a stricter contract for the CRITICAL commander and decisive critical reviewer.
- Let the parent AI route from meaning, ambiguity, proof burden, failure impact, and prior failed attempts rather than keywords, then hand command to the selected strong lane.
- Keep strong-model judgment in the command plan while the parent mechanically dispatches the bounded worker and sends the bounded review packet to the direct OpenCode Go MCP route; the v3 marker selects a concrete worker whose static model pin equals the effective starting parent model and whose effort is inherited. Generic worker aliases, ad hoc overrides, and a native reviewer result are not completion evidence for the STANDARD external review lane.
- Keep the durable definition in [`codex-architecture-mode.md`](codex-architecture-mode.md) and the role configs in [`.codex/agents/`](../.codex/agents/). Smart roles are [`.codex/agents/architect.toml`](../.codex/agents/architect.toml), [`.codex/agents/reviewer.toml`](../.codex/agents/reviewer.toml), [`.codex/agents/critical_architect.toml`](../.codex/agents/critical_architect.toml), and [`.codex/agents/critical_reviewer.toml`](../.codex/agents/critical_reviewer.toml); worker roles are the model-specific `worker_gpt_*` files.

## Approved model policy

- Worker lane: use the v3 marker-selected static model pin matching the effective starting parent; inherit only its reasoning effort
- STANDARD commander: `gpt-5.6-sol` with `max` reasoning
- STANDARD reviewer: direct OpenCode Go MCP, runtime-selected from the live candidate order in this contract
- CRITICAL commander / critical review model: `gpt-5.6-sol` with `max` reasoning
- The preferred order is policy, not a durable selection. At restore/run time, use the current live model and bridge preflight. If no configured OpenCode Go reviewer route is live, stop with `opencode_go_reviewer_route_unavailable`.
- If a native Codex model is unavailable, use the same-role fallback chain `Sol → Terra → 5.5 → 5.4` for strong lanes and `Luna → 5.4-mini → 5.4` for fast lanes. Try each candidate at most once after live model preflight, use a supported reasoning effort (for example `max → xhigh` on 5.5), and write a bounded `model_fallback.v1` receipt with the requested/selected model and effort, failure code, attempts, and Codex App tool/thread provenance. With `codex_app__create_thread` / `codex_app__send_message_to_thread`, resend the same bounded packet on the same thread using the next `model`/`thinking` pair; do not create a replacement thread. This does not authorize fallback across OpenCode providers or browser surfaces.
- For OpenCode Go review, require verified provider/model metadata, a supported bridge version, request ID, usage, and bounded output from the direct MCP route. Only model unavailability, provider/model timeout, model rate limit, or missing final response may advance to the next live same-role OpenCode Go candidate. Auth, provider, bridge, schema, task, safety, malformed-output, and missing-route failures stop; do not substitute native Sol or another provider.

## Durable Adaptive surfaces

- Recovery boundary: [`adaptive-orchestration-manifest.v1.json`](adaptive-orchestration-manifest.v1.json)
- Portable restore procedure: [`adaptive-orchestration-recovery.md`](adaptive-orchestration-recovery.md)
- Architecture and role contracts: [`codex-architecture-mode.md`](codex-architecture-mode.md) and the role files listed by the manifest
- Native dispatch implementation: [`../src/social_flow/codex_model_dispatch.py`](../src/social_flow/codex_model_dispatch.py)

## Practical effect

- Model choice is explicit, meaning-based, and testable.
- Long-running workflows are anchored in workspace docs and artifacts.
- Review stays separate from routine execution.
- Routine execution stays on the starting parent or worker lane; the STANDARD commander uses Sol, the independent STANDARD review uses the live OpenCode Go route, and CRITICAL keeps the stricter native Sol contract.
- Safety gates remain fail-closed instead of depending on model behavior alone.
